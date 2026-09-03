import type { StoreEntry } from '../../core/types.js'
import type { ClusterRequest, ClusterResponse } from './protocol.js'

// Timer functions available in all JS runtimes (Node, Deno, Bun, browsers)
declare function setInterval(callback: () => void, ms: number): unknown
declare function clearInterval(handle: unknown): void
declare function setTimeout(callback: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

export interface PrimaryStateConfig {
  /** Maximum entries before LRU eviction. Default: Infinity */
  maxEntries?: number | undefined
  /** Interval in ms for active cleanup sweep. Default: 60000 (0 disables) */
  cleanupInterval?: number | undefined
  /** Milliseconds a worker may hold a key lock before it is force-released. Default: 1000 */
  lockTimeout?: number | undefined
  /** Callback fired when an entry is evicted by the LRU. */
  onEviction?: ((key: string, entry: StoreEntry) => void) | undefined
}

export interface VersionedEntry {
  entry: StoreEntry
  version: number
}

export type Respond = (response: ClusterResponse) => void

/**
 * Authoritative rate limit state owned by the primary process.
 *
 * Two write paths are exposed to workers:
 *
 * - `cas` - optimistic. Every mutation bumps a process-wide monotonic version
 *   counter; a worker echoes the version it last observed and the write is
 *   rejected if it no longer matches. One round trip, but a worker can lose
 *   repeatedly on a hot key.
 * - `lock`/`commit` - fair. The key is handed out FIFO, so a contended key
 *   makes progress in arrival order with no starvation and no lost updates.
 *   Locks are force-released after `lockTimeout` so a dead worker cannot wedge
 *   a key.
 *
 * The primary is single-threaded, so each request runs to completion before the
 * next one is dequeued - no further locking is required.
 */
export interface PrimaryState {
  handle(request: ClusterRequest, respond: Respond): void
  get(key: string): VersionedEntry | null
  set(key: string, entry: StoreEntry): number
  delete(key: string): void
  clear(): void
  keys(prefix?: string | undefined): string[]
  /** Number of live (non-expired) entries. Primarily for tests and metrics. */
  size(): number
  /** Number of keys currently locked or queued. Primarily for tests. */
  lockCount(): number
  dispose(): void
}

interface InternalEntry {
  entry: StoreEntry
  version: number
  accessedAt: number
}

interface LockEntry {
  token: number
  timer: unknown
  queue: Respond[]
}

function unref(timer: unknown): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    ;(timer as { unref: () => void }).unref()
  }
}

export function createPrimaryState(config: PrimaryStateConfig = {}): PrimaryState {
  const {
    maxEntries = Number.POSITIVE_INFINITY,
    cleanupInterval = 60_000,
    lockTimeout = 1000,
    onEviction,
  } = config

  const entries = new Map<string, InternalEntry>()
  const locks = new Map<string, LockEntry>()

  let version = 0
  let token = 0
  // Monotonic counter rather than Date.now() so LRU order is exact even when
  // many entries are touched within the same millisecond.
  let accessClock = 0
  let sweeper: unknown = null

  function isLive(internal: InternalEntry | undefined): internal is InternalEntry {
    return internal !== undefined && internal.entry.expiresAt > Date.now()
  }

  function evictLRU(): void {
    if (entries.size <= maxEntries) return

    let oldestKey: string | null = null
    let oldestAccess = Number.POSITIVE_INFINITY

    for (const [key, internal] of entries) {
      if (internal.accessedAt < oldestAccess) {
        oldestAccess = internal.accessedAt
        oldestKey = key
      }
    }

    if (oldestKey !== null) {
      const evicted = entries.get(oldestKey)
      entries.delete(oldestKey)
      if (evicted && onEviction) onEviction(oldestKey, evicted.entry)
    }
  }

  function cleanup(): void {
    const now = Date.now()
    for (const [key, internal] of entries) {
      if (internal.entry.expiresAt <= now) entries.delete(key)
    }
  }

  function write(key: string, entry: StoreEntry): number {
    const next = ++version
    entries.set(key, { entry, version: next, accessedAt: ++accessClock })
    if (entries.size > maxEntries) evictLRU()
    return next
  }

  if (cleanupInterval > 0) {
    sweeper = setInterval(cleanup, cleanupInterval)
    unref(sweeper)
  }

  // ─── Key locks ─────────────────────────────────────────────────────────────

  function grant(key: string, lock: LockEntry, respond: Respond): void {
    lock.token = ++token
    const granted = lock.token
    lock.timer = setTimeout(() => {
      release(key, granted)
    }, lockTimeout)
    unref(lock.timer)

    const current = state.get(key)
    respond({
      op: 'lock',
      token: granted,
      entry: current === null ? null : current.entry,
      version: current === null ? null : current.version,
    })
  }

  function acquire(key: string, respond: Respond): void {
    const existing = locks.get(key)
    if (existing !== undefined) {
      existing.queue.push(respond)
      return
    }
    const lock: LockEntry = { token: 0, timer: null, queue: [] }
    locks.set(key, lock)
    grant(key, lock, respond)
  }

  function release(key: string, heldToken: number): boolean {
    const lock = locks.get(key)
    if (lock === undefined || lock.token !== heldToken) return false

    clearTimeout(lock.timer)
    lock.timer = null

    const next = lock.queue.shift()
    if (next === undefined) {
      locks.delete(key)
      return true
    }
    grant(key, lock, next)
    return true
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  const state: PrimaryState = {
    get(key: string): VersionedEntry | null {
      const internal = entries.get(key)
      if (!isLive(internal)) {
        if (internal) entries.delete(key)
        return null
      }
      internal.accessedAt = ++accessClock
      return { entry: internal.entry, version: internal.version }
    },

    set(key: string, entry: StoreEntry): number {
      return write(key, entry)
    },

    delete(key: string): void {
      entries.delete(key)
    },

    clear(): void {
      entries.clear()
    },

    keys(prefix?: string | undefined): string[] {
      const now = Date.now()
      const result: string[] = []
      for (const [key, internal] of entries) {
        if (internal.entry.expiresAt <= now) continue
        if (prefix && !key.startsWith(prefix)) continue
        result.push(key)
      }
      return result
    },

    size(): number {
      const now = Date.now()
      let count = 0
      for (const internal of entries.values()) {
        if (internal.entry.expiresAt > now) count++
      }
      return count
    },

    lockCount(): number {
      return locks.size
    },

    handle(request: ClusterRequest, respond: Respond): void {
      switch (request.op) {
        case 'get': {
          const current = state.get(request.key)
          respond({
            op: 'get',
            entry: current === null ? null : current.entry,
            version: current === null ? null : current.version,
          })
          return
        }

        case 'set':
          respond({ op: 'set', version: state.set(request.key, request.entry) })
          return

        case 'cas': {
          const current = state.get(request.key)
          const currentVersion = current === null ? null : current.version

          // An optimistic write must never slip past a worker that is holding
          // the key, or it would be silently overwritten by that worker's
          // commit. Reject and let the worker join the queue instead.
          if (locks.has(request.key) || currentVersion !== request.expected) {
            respond({
              op: 'cas',
              ok: false,
              version: currentVersion,
              entry: current === null ? null : current.entry,
            })
            return
          }

          respond({ op: 'cas', ok: true, version: write(request.key, request.entry), entry: null })
          return
        }

        case 'lock':
          // May respond later, once the key's queue drains.
          acquire(request.key, respond)
          return

        case 'commit': {
          const lock = locks.get(request.key)
          if (lock === undefined || lock.token !== request.token) {
            respond({ op: 'commit', ok: false, version: null })
            return
          }
          const committed = write(request.key, request.entry)
          release(request.key, request.token)
          respond({ op: 'commit', ok: true, version: committed })
          return
        }

        case 'unlock':
          release(request.key, request.token)
          respond({ op: 'unlock' })
          return

        case 'delete':
          state.delete(request.key)
          respond({ op: 'delete' })
          return

        case 'clear':
          state.clear()
          respond({ op: 'clear' })
          return

        case 'keys':
          respond({ op: 'keys', keys: state.keys(request.prefix ?? undefined) })
          return

        case 'ping':
          respond({ op: 'ping', ok: true })
      }
    },

    dispose(): void {
      if (sweeper !== null) {
        clearInterval(sweeper)
        sweeper = null
      }
      for (const lock of locks.values()) {
        clearTimeout(lock.timer)
      }
      locks.clear()
      entries.clear()
    },
  }

  return state
}

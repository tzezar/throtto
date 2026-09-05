import { StoreError } from '../../core/errors.js'
import type { Store, StoreEntry } from '../../core/types.js'
import { memoryStore } from '../memory.js'
import { createPrimaryState } from './primary.js'
import type { PrimaryState } from './primary.js'
import {
  CLUSTER_PROTOCOL,
  type ClusterRequest,
  type ClusterRequestOp,
  type ClusterResponseEnvelope,
  type ClusterResponseFor,
  isClusterRequest,
  isClusterResponse,
} from './protocol.js'
import { nodeClusterTransport } from './transport.js'
import type { ClusterRole, ClusterTransport } from './transport.js'

// Timer functions available in all JS runtimes (Node, Deno, Bun, browsers)
declare function setTimeout(callback: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

export type { ClusterRole, ClusterPeer, ClusterTransport } from './transport.js'
export { nodeClusterTransport, detectRole } from './transport.js'
export type { ClusterRequest, ClusterResponse } from './protocol.js'
export { CLUSTER_PROTOCOL } from './protocol.js'

/**
 * Consecutive optimistic failures on a key before the worker stops guessing and
 * goes straight to the fair lock path. Keeps uncontended keys at one IPC round
 * trip while contended keys settle at two instead of retrying forever.
 */
const CAS_MISS_THRESHOLD = 2

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ClusterStoreConfig {
  /** Maximum entries held on the primary before LRU eviction. Default: Infinity */
  maxEntries?: number | undefined
  /** Interval in ms for the primary's expired-entry sweep. Default: 60000 (0 disables) */
  cleanupInterval?: number | undefined
  /** Fired on the primary when an entry is evicted by the LRU. */
  onEviction?: ((key: string, entry: StoreEntry) => void) | undefined
  /** Force a role instead of auto-detecting from the process environment. */
  role?: ClusterRole | undefined
  /** Milliseconds to wait for a primary response before degrading. Default: 1000 */
  timeout?: number | undefined
  /**
   * Behaviour when the primary cannot be reached.
   * - `'local'`: fall back to a per-worker in-memory store (approximate limiting)
   * - `'error'`: throw, letting the limiter's own `failMode` decide
   *
   * Default: `'local'`
   */
  onUnreachable?: 'local' | 'error' | undefined
  /** Milliseconds to stay degraded before retrying IPC. Default: 5000 */
  retryInterval?: number | undefined
  /** Attempts to acquire and commit a contended key before giving up. Default: 3 */
  maxRetries?: number | undefined
  /**
   * Milliseconds a worker may hold a key lock on the primary before it is
   * force-released, so a crashed worker cannot wedge a key. Default: 1000
   */
  lockTimeout?: number | undefined
  /** Size of the worker-side version cache. Default: 1000 */
  cacheEntries?: number | undefined
  /** Called the first time the store degrades to local state. */
  onDegraded?: ((error: Error) => void) | undefined
  /** Called when the primary becomes reachable again. */
  onRecovered?: (() => void) | undefined
  /** Custom transport. Defaults to the Node `cluster` IPC channel. */
  transport?: ClusterTransport | undefined
  /** Isolates multiple cluster stores sharing one IPC channel. Default: 'default' */
  namespace?: string | undefined
}

export interface ClusterStore extends Store {
  /** Resolves once this process is wired to the IPC channel. */
  ready(): Promise<void>
  /** True when this process owns the authoritative rate limit state. */
  readonly isPrimary: boolean
  /** True while the worker is running on local fallback state. */
  readonly degraded: boolean
}

interface PendingRequest {
  resolve: (response: ClusterResponseEnvelope) => void
  reject: (error: Error) => void
  timer: unknown
}

interface CachedVersion {
  entry: StoreEntry
  version: number
  /** Consecutive optimistic write failures observed for this key. */
  misses: number
}

// ─── Store ───────────────────────────────────────────────────────────────────

/**
 * Share rate limit state across Node.js cluster workers without an external
 * store.
 *
 * The primary process holds the state; workers proxy every operation over the
 * existing IPC channel. Because the primary is single-threaded, updates are
 * serialized by its event loop - no distributed locking required.
 *
 * Uncontended keys cost a single round trip: the worker remembers the version
 * it last wrote and folds read and write into one compare-and-swap. Once a key
 * shows contention the worker switches to the primary's FIFO lock so competing
 * workers take turns instead of starving each other.
 */
export function clusterStore(config: ClusterStoreConfig = {}): ClusterStore {
  const {
    maxEntries = Number.POSITIVE_INFINITY,
    cleanupInterval = 60_000,
    onEviction,
    timeout = 1000,
    onUnreachable = 'local',
    retryInterval = 5000,
    maxRetries = 3,
    lockTimeout = 1000,
    cacheEntries = 1000,
    onDegraded,
    onRecovered,
    namespace = 'default',
  } = config

  const transport =
    config.transport ?? nodeClusterTransport(config.role === undefined ? {} : { role: config.role })
  const isPrimary = transport.role === 'primary'

  let state: PrimaryState | null = null
  let fallback: Store | null = null
  let isShutdown = false
  let degradedSince: number | null = null
  let sequence = 0

  const pending = new Map<number, PendingRequest>()
  const versionCache = new Map<string, CachedVersion>()
  const keyLocks = new Map<string, Promise<void>>()

  // ─── Per-key serialization ─────────────────────────────────────────────────

  /**
   * Run `fn` after any other in-flight operation on the same key.
   *
   * The primary already serializes writes, so letting one worker fire dozens of
   * concurrent updates at a hot key only produces losers and queue churn.
   * Queueing locally caps it at one in-flight update per key per worker.
   * Different keys are unaffected and still run in parallel.
   */
  function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = keyLocks.get(key)
    const run = previous === undefined ? fn() : previous.then(fn)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    keyLocks.set(key, settled)
    void settled.then(() => {
      if (keyLocks.get(key) === settled) keyLocks.delete(key)
    })
    return run
  }

  // ─── Local fallback ────────────────────────────────────────────────────────

  function local(): Store {
    fallback ??= memoryStore({ maxEntries, cleanupInterval })
    return fallback
  }

  function markDegraded(error: Error): void {
    const wasHealthy = degradedSince === null
    degradedSince = Date.now()
    if (wasHealthy) onDegraded?.(error)
  }

  function markHealthy(): void {
    if (degradedSince === null) return
    degradedSince = null
    versionCache.clear()
    onRecovered?.()
  }

  /** True while the worker should skip IPC and read/write local state. */
  function useLocal(): boolean {
    if (isShutdown) return true
    if (degradedSince === null) return false
    // Once the cooldown elapses, let requests probe the primary again.
    return Date.now() - degradedSince < retryInterval
  }

  async function degrade<T>(error: unknown, fn: () => Promise<T>): Promise<T> {
    const wrapped = error instanceof Error ? error : new StoreError(String(error), 'clusterStore')
    markDegraded(wrapped)
    if (onUnreachable === 'error') throw wrapped
    return fn()
  }

  // ─── Version cache (LRU by insertion order) ────────────────────────────────

  function remember(key: string, entry: StoreEntry, version: number, misses: number): void {
    versionCache.delete(key)
    versionCache.set(key, { entry, version, misses })
    if (versionCache.size > cacheEntries) {
      const oldest = versionCache.keys().next()
      if (!oldest.done) versionCache.delete(oldest.value)
    }
  }

  function forget(key: string): void {
    versionCache.delete(key)
  }

  function liveEntry(entry: StoreEntry | null | undefined): StoreEntry | null {
    if (entry === null || entry === undefined) return null
    return entry.expiresAt > Date.now() ? entry : null
  }

  // ─── IPC ───────────────────────────────────────────────────────────────────

  function request<TOp extends ClusterRequestOp>(
    payload: Extract<ClusterRequest, { op: TOp }>,
  ): Promise<ClusterResponseFor<TOp>> {
    return new Promise<ClusterResponseFor<TOp>>((resolve, reject) => {
      if (!transport.isConnected()) {
        reject(new StoreError('Cluster IPC channel is closed', 'clusterStore'))
        return
      }

      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(
          new StoreError(
            `Cluster primary did not respond within ${timeout}ms (op: ${payload.op})`,
            'clusterStore',
          ),
        )
      }, timeout)

      pending.set(id, {
        timer,
        reject,
        resolve: (envelope) => {
          if (envelope.error !== null) {
            reject(new StoreError(envelope.error, 'clusterStore'))
            return
          }
          markHealthy()
          resolve(envelope.response as ClusterResponseFor<TOp>)
        },
      })

      const sent = transport.send({
        protocol: CLUSTER_PROTOCOL,
        namespace,
        id,
        request: payload,
      })

      if (!sent) {
        clearTimeout(timer)
        pending.delete(id)
        reject(new StoreError('Failed to send message to cluster primary', 'clusterStore'))
      }
    })
  }

  function handleResponse(message: unknown): void {
    if (!isClusterResponse(message, namespace)) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    entry.resolve(message)
  }

  // ─── Wiring ────────────────────────────────────────────────────────────────

  const readyPromise: Promise<void> = (async () => {
    if (isPrimary) {
      state = createPrimaryState({
        maxEntries,
        cleanupInterval,
        lockTimeout,
        ...(onEviction === undefined ? {} : { onEviction }),
      })

      await transport.listen((message, peer) => {
        if (!isClusterRequest(message, namespace) || state === null) return

        const reply = (envelope: ClusterResponseEnvelope): void => {
          peer.send(envelope)
        }

        try {
          // `lock` may respond later, once the key's queue drains.
          state.handle(message.request, (response) => {
            reply({
              protocol: CLUSTER_PROTOCOL,
              namespace,
              id: message.id,
              response,
              error: null,
            })
          })
        } catch (error) {
          reply({
            protocol: CLUSTER_PROTOCOL,
            namespace,
            id: message.id,
            response: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
      return
    }

    await transport.subscribe(handleResponse)
  })()

  // Surface wiring failures through ready(); never as an unhandled rejection.
  readyPromise.catch(() => undefined)

  async function ensureReady(): Promise<void> {
    await readyPromise
  }

  // ─── Primary-local implementation ──────────────────────────────────────────

  const primaryStore: Store = {
    async get(key) {
      await ensureReady()
      return state?.get(key)?.entry ?? null
    },
    async set(key, entry) {
      await ensureReady()
      state?.set(key, entry)
    },
    async delete(key) {
      await ensureReady()
      state?.delete(key)
    },
    async clear() {
      await ensureReady()
      state?.clear()
    },
    async atomic(key, updater) {
      await ensureReady()
      if (state === null) return updater(null)
      const current = state.get(key)
      const updated = updater(current?.entry ?? null)
      state.set(key, updated)
      return updated
    },
    async keys(prefix) {
      await ensureReady()
      return state?.keys(prefix) ?? []
    },
    async ping() {
      return !isShutdown
    },
  }

  // ─── Worker implementation ─────────────────────────────────────────────────

  /** Optimistic single round trip. Returns null when the version had moved on. */
  async function tryCas(
    key: string,
    cached: CachedVersion | undefined,
    updater: (current: StoreEntry | null) => StoreEntry,
  ): Promise<StoreEntry | null> {
    const expected = cached?.version ?? null
    const updated = updater(liveEntry(cached?.entry))
    const response = await request({ op: 'cas', key, expected, entry: updated })

    if (response.ok && response.version !== null) {
      remember(key, updated, response.version, 0)
      return updated
    }

    if (response.entry !== null && response.version !== null) {
      remember(key, response.entry, response.version, (cached?.misses ?? 0) + 1)
    } else {
      forget(key)
    }
    return null
  }

  /** Fair path: queue for the key on the primary, then read-modify-commit. */
  async function lockAndCommit(
    key: string,
    updater: (current: StoreEntry | null) => StoreEntry,
    misses: number,
  ): Promise<StoreEntry> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const lock = await request({ op: 'lock', key })

      let updated: StoreEntry
      try {
        updated = updater(liveEntry(lock.entry))
      } catch (error) {
        await request({ op: 'unlock', key, token: lock.token }).catch(() => undefined)
        throw error
      }

      const commit = await request({ op: 'commit', key, token: lock.token, entry: updated })
      if (commit.ok && commit.version !== null) {
        // Decay the miss counter so the fast path is retried once the key cools.
        remember(key, updated, commit.version, Math.max(0, misses - 1))
        return updated
      }

      // The lock expired before the commit landed - take another turn.
      forget(key)
    }

    throw new StoreError(
      `Could not commit key "${key}" after ${maxRetries} attempts`,
      'clusterStore',
    )
  }

  const workerStore: Store = {
    async get(key) {
      await ensureReady()
      if (useLocal()) return local().get(key)
      try {
        const response = await request({ op: 'get', key })
        if (response.entry !== null && response.version !== null) {
          remember(key, response.entry, response.version, versionCache.get(key)?.misses ?? 0)
        } else {
          forget(key)
        }
        return response.entry
      } catch (error) {
        return degrade(error, () => local().get(key))
      }
    },

    async set(key, entry, ttlMs) {
      await ensureReady()
      if (useLocal()) return local().set(key, entry, ttlMs)
      try {
        const response = await request({ op: 'set', key, entry })
        remember(key, entry, response.version, 0)
      } catch (error) {
        await degrade(error, () => local().set(key, entry, ttlMs))
      }
    },

    async delete(key) {
      await ensureReady()
      forget(key)
      if (useLocal()) return local().delete(key)
      try {
        await request({ op: 'delete', key })
      } catch (error) {
        await degrade(error, () => local().delete(key))
      }
    },

    async clear() {
      await ensureReady()
      versionCache.clear()
      if (useLocal()) return local().clear()
      try {
        await request({ op: 'clear' })
      } catch (error) {
        await degrade(error, () => local().clear())
      }
    },

    async atomic(key, updater, ttlMs) {
      await ensureReady()
      return withKeyLock(key, async () => {
        if (useLocal()) return local().atomic?.(key, updater, ttlMs) ?? updater(null)

        try {
          const cached = versionCache.get(key)
          const misses = cached?.misses ?? 0

          if (misses < CAS_MISS_THRESHOLD) {
            const updated = await tryCas(key, cached, updater)
            if (updated !== null) return updated
          }

          return await lockAndCommit(key, updater, versionCache.get(key)?.misses ?? misses)
        } catch (error) {
          return degrade(error, async () => {
            const store = local()
            return store.atomic?.(key, updater, ttlMs) ?? updater(null)
          })
        }
      })
    },

    async keys(prefix) {
      await ensureReady()
      if (useLocal()) return local().keys?.(prefix) ?? []
      try {
        const response = await request({ op: 'keys', prefix: prefix ?? null })
        return response.keys
      } catch (error) {
        return degrade(error, async () => local().keys?.(prefix) ?? [])
      }
    },

    async ping() {
      if (isShutdown) return false
      try {
        await ensureReady()
        const response = await request({ op: 'ping' })
        return response.ok
      } catch {
        return false
      }
    },
  }

  const delegate = isPrimary ? primaryStore : workerStore

  const store: ClusterStore = {
    get isPrimary() {
      return isPrimary
    },
    get degraded() {
      return degradedSince !== null
    },

    ready: ensureReady,

    get: (key) => delegate.get(key),
    set: (key, entry, ttlMs) => delegate.set(key, entry, ttlMs),
    delete: (key) => delegate.delete(key),
    clear: () => delegate.clear(),
    atomic: (key, updater, ttlMs) =>
      delegate.atomic?.(key, updater, ttlMs) ?? Promise.resolve(updater(null)),
    keys: (prefix) => delegate.keys?.(prefix) ?? Promise.resolve([]),
    ping: () => delegate.ping?.() ?? Promise.resolve(false),

    async shutdown(): Promise<void> {
      isShutdown = true

      for (const [, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(new StoreError('Cluster store was shut down', 'clusterStore'))
      }
      pending.clear()
      versionCache.clear()
      keyLocks.clear()

      await transport.close()
      state?.dispose()
      state = null
      await fallback?.shutdown?.()
      fallback = null
    },
  }

  return store
}

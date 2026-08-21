import type { Store, StoreEntry } from '../core/types.js'

// Timer functions available in all JS runtimes (Node, Deno, Bun, browsers)
declare function setInterval(callback: () => void, ms: number): unknown
declare function clearInterval(handle: unknown): void

export interface MemoryStoreConfig {
  /** Maximum entries before LRU eviction. Default: Infinity */
  maxEntries?: number | undefined
  /** Interval in ms for active cleanup sweep. Set to 0 for serverless (no intervals). Default: 60000 */
  cleanupInterval?: number | undefined
  /** Callback fired when an entry is evicted */
  onEviction?: ((key: string, entry: StoreEntry) => void) | undefined
}

interface InternalEntry {
  entry: StoreEntry
  accessedAt: number
}

/**
 * In-memory store with TTL, LRU eviction, and periodic cleanup.
 *
 * Features:
 * - Passive TTL check on get (expired entries return null)
 * - Active periodic cleanup (sweeps expired entries)
 * - LRU eviction when maxEntries exceeded
 * - Atomic read-modify-write (synchronous, single-process safe)
 * - Serverless mode (cleanupInterval: 0 - no intervals)
 * - shutdown() clears intervals and data
 */
export function memoryStore(config: MemoryStoreConfig = {}): Store {
  const { maxEntries = Number.POSITIVE_INFINITY, cleanupInterval = 60_000, onEviction } = config
  const entries = new Map<string, InternalEntry>()
  let timer: unknown = null
  let isShutdown = false

  function now(): number {
    return Date.now()
  }

  function isExpired(internal: InternalEntry): boolean {
    return internal.entry.expiresAt <= now()
  }

  function evictLRU(): void {
    if (entries.size <= maxEntries) return

    // Find least recently accessed entry
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
      if (evicted && onEviction) {
        onEviction(oldestKey, evicted.entry)
      }
    }
  }

  function cleanup(): void {
    const currentTime = now()
    for (const [key, internal] of entries) {
      if (internal.entry.expiresAt <= currentTime) {
        entries.delete(key)
      }
    }
  }

  // Start cleanup interval if configured
  if (cleanupInterval > 0) {
    timer = setInterval(cleanup, cleanupInterval)
    // Unref the timer so it doesn't prevent process exit
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      ;(timer as { unref: () => void }).unref()
    }
  }

  const store: Store = {
    async get(key: string): Promise<StoreEntry | null> {
      if (isShutdown) return null

      const internal = entries.get(key)
      if (!internal) return null

      if (isExpired(internal)) {
        entries.delete(key)
        return null
      }

      // Update access time for LRU
      internal.accessedAt = now()
      return internal.entry
    },

    async set(key: string, entry: StoreEntry, _ttlMs: number): Promise<void> {
      if (isShutdown) return

      entries.set(key, { entry, accessedAt: now() })

      // Check if we need eviction
      if (entries.size > maxEntries) {
        evictLRU()
      }
    },

    async delete(key: string): Promise<void> {
      entries.delete(key)
    },

    async clear(): Promise<void> {
      entries.clear()
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      ttlMs: number,
    ): Promise<StoreEntry> {
      if (isShutdown) {
        const result = updater(null)
        return result
      }

      const internal = entries.get(key)
      let current: StoreEntry | null = null

      if (internal && !isExpired(internal)) {
        current = internal.entry
      }

      const updated = updater(current)
      entries.set(key, { entry: updated, accessedAt: now() })

      if (entries.size > maxEntries) {
        evictLRU()
      }

      return updated
    },

    async keys(prefix?: string): Promise<string[]> {
      const result: string[] = []
      for (const key of entries.keys()) {
        if (!prefix || key.startsWith(prefix)) {
          const internal = entries.get(key)!
          if (internal.entry.expiresAt > now()) {
            result.push(key)
          }
        }
      }
      return result
    },

    async ping(): Promise<boolean> {
      return !isShutdown
    },

    async shutdown(): Promise<void> {
      isShutdown = true
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      entries.clear()
    },
  }

  return store
}

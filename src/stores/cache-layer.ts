import type { Store, StoreEntry } from '../core/types.js'

export interface CacheLayerConfig {
  /** How long to cache entries locally (ms). Default: 5000 */
  localTtl?: number | undefined
  /** Max entries in local cache. Default: 1000 */
  maxLocalEntries?: number | undefined
}

interface LocalEntry {
  entry: StoreEntry
  cachedAt: number
}

/**
 * Wrap a remote store with a local in-memory cache layer.
 *
 * Reduces latency and load on the remote store by caching
 * entries locally with a short TTL.
 */
export function withCache(remote: Store, config: CacheLayerConfig = {}): Store {
  const { localTtl = 5000, maxLocalEntries = 1000 } = config
  const local = new Map<string, LocalEntry>()

  function isLocalFresh(entry: LocalEntry): boolean {
    return Date.now() - entry.cachedAt < localTtl
  }

  function pruneLocal(): void {
    if (local.size <= maxLocalEntries) return
    // Remove oldest entries
    const entries = [...local.entries()]
    entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt)
    const toRemove = entries.slice(0, entries.length - maxLocalEntries)
    for (const [key] of toRemove) {
      local.delete(key)
    }
  }

  return {
    async get(key: string): Promise<StoreEntry | null> {
      // Check local cache first
      const cached = local.get(key)
      if (cached && isLocalFresh(cached)) {
        return cached.entry
      }

      // Fall through to remote
      const entry = await remote.get(key)
      if (entry) {
        local.set(key, { entry, cachedAt: Date.now() })
        pruneLocal()
      } else {
        local.delete(key)
      }
      return entry
    },

    async set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
      // Update both local and remote
      local.set(key, { entry, cachedAt: Date.now() })
      pruneLocal()
      await remote.set(key, entry, ttlMs)
    },

    async delete(key: string): Promise<void> {
      local.delete(key)
      await remote.delete(key)
    },

    async clear(): Promise<void> {
      local.clear()
      await remote.clear()
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      ttlMs: number,
    ): Promise<StoreEntry> {
      if (remote.atomic) {
        const result = await remote.atomic(key, updater, ttlMs)
        local.set(key, { entry: result, cachedAt: Date.now() })
        pruneLocal()
        return result
      }
      // Fallback: get-update-set (non-atomic)
      const current = await remote.get(key)
      const updated = updater(current)
      await remote.set(key, updated, ttlMs)
      local.set(key, { entry: updated, cachedAt: Date.now() })
      pruneLocal()
      return updated
    },

    async shutdown(): Promise<void> {
      local.clear()
      await remote.shutdown?.()
    },
  }
}

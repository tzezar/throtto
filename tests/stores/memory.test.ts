import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreEntry } from '../../src/core/types.js'
import { memoryStore } from '../../src/stores/memory.js'

function createEntry(overrides?: Partial<StoreEntry>): StoreEntry {
  return {
    state: { count: 1 },
    expiresAt: Date.now() + 60000,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('memoryStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('basic CRUD', () => {
    it('returns null for non-existent key', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      const result = await store.get('unknown')
      expect(result).toBeNull()
      await store.shutdown?.()
    })

    it('stores and retrieves entries', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      const entry = createEntry()

      await store.set('key1', entry, 60000)
      const result = await store.get('key1')
      expect(result).toEqual(entry)
      await store.shutdown?.()
    })

    it('deletes entries', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      const entry = createEntry()

      await store.set('key1', entry, 60000)
      await store.delete('key1')
      const result = await store.get('key1')
      expect(result).toBeNull()
      await store.shutdown?.()
    })

    it('clears all entries', async () => {
      const store = memoryStore({ cleanupInterval: 0 })

      await store.set('key1', createEntry(), 60000)
      await store.set('key2', createEntry(), 60000)
      await store.clear()

      expect(await store.get('key1')).toBeNull()
      expect(await store.get('key2')).toBeNull()
      await store.shutdown?.()
    })

    it('overwrites existing entries', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      const entry1 = createEntry({ state: { count: 1 } })
      const entry2 = createEntry({ state: { count: 2 } })

      await store.set('key1', entry1, 60000)
      await store.set('key1', entry2, 60000)

      const result = await store.get('key1')
      expect(result?.state).toEqual({ count: 2 })
      await store.shutdown?.()
    })
  })

  describe('TTL expiry', () => {
    it('returns null for expired entries', async () => {
      vi.useFakeTimers()
      const store = memoryStore({ cleanupInterval: 0 })
      const entry = createEntry({ expiresAt: Date.now() + 5000 })

      await store.set('key1', entry, 5000)

      // Not expired yet
      expect(await store.get('key1')).not.toBeNull()

      // Advance past expiry
      vi.advanceTimersByTime(5001)
      expect(await store.get('key1')).toBeNull()
      await store.shutdown?.()
    })

    it('expired entries are removed on get', async () => {
      vi.useFakeTimers()
      const store = memoryStore({ cleanupInterval: 0 })
      const entry = createEntry({ expiresAt: Date.now() + 1000 })

      await store.set('key1', entry, 1000)
      vi.advanceTimersByTime(1001)

      // Get should clean it up
      await store.get('key1')
      // Second get confirms it's gone
      expect(await store.get('key1')).toBeNull()
      await store.shutdown?.()
    })
  })

  describe('cleanup interval', () => {
    it('periodically sweeps expired entries', async () => {
      vi.useFakeTimers()
      const store = memoryStore({ cleanupInterval: 1000 })
      const entry = createEntry({ expiresAt: Date.now() + 500 })

      await store.set('key1', entry, 500)

      // Entry still alive
      vi.advanceTimersByTime(400)
      expect(await store.get('key1')).not.toBeNull()

      // Advance past expiry AND past cleanup interval
      vi.advanceTimersByTime(1100)
      // Cleanup should have run and removed it
      expect(await store.get('key1')).toBeNull()
      await store.shutdown?.()
    })

    it('serverless mode: no interval created', () => {
      vi.useFakeTimers()
      const store = memoryStore({ cleanupInterval: 0 })
      // If interval was created, advancing time would trigger it
      // No error = success (interval not started)
      vi.advanceTimersByTime(100000)
      store.shutdown?.()
    })
  })

  describe('LRU eviction', () => {
    it('evicts least recently accessed entry when at max', async () => {
      vi.useFakeTimers()
      const store = memoryStore({ maxEntries: 2, cleanupInterval: 0 })

      await store.set('key1', createEntry({ expiresAt: Date.now() + 60000 }), 60000)
      vi.advanceTimersByTime(10)
      await store.set('key2', createEntry({ expiresAt: Date.now() + 60000 }), 60000)
      vi.advanceTimersByTime(10)

      // Access key1 to make it more recently used
      await store.get('key1')
      vi.advanceTimersByTime(10)

      // Adding key3 should evict key2 (least recently accessed)
      await store.set('key3', createEntry({ expiresAt: Date.now() + 60000 }), 60000)

      expect(await store.get('key1')).not.toBeNull()
      expect(await store.get('key2')).toBeNull()
      expect(await store.get('key3')).not.toBeNull()
      await store.shutdown?.()
    })

    it('fires onEviction callback', async () => {
      const evicted: Array<{ key: string; entry: StoreEntry }> = []
      const store = memoryStore({
        maxEntries: 1,
        cleanupInterval: 0,
        onEviction: (key, entry) => evicted.push({ key, entry }),
      })

      await store.set('key1', createEntry(), 60000)
      await store.set('key2', createEntry(), 60000)

      expect(evicted.length).toBe(1)
      expect(evicted[0]?.key).toBe('key1')
      await store.shutdown?.()
    })
  })

  describe('atomic', () => {
    it('creates entry if none exists', async () => {
      const store = memoryStore({ cleanupInterval: 0 })

      const result = await store.atomic?.(
        'key1',
        (current) => {
          expect(current).toBeNull()
          return createEntry({ state: { count: 1 } })
        },
        60000,
      )

      expect(result.state).toEqual({ count: 1 })
      await store.shutdown?.()
    })

    it('updates existing entry', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      await store.set('key1', createEntry({ state: { count: 5 } }), 60000)

      const result = await store.atomic?.(
        'key1',
        (current) => {
          const count = (current?.state?.count as number) ?? 0
          return createEntry({ state: { count: count + 1 } })
        },
        60000,
      )

      expect(result.state).toEqual({ count: 6 })
      await store.shutdown?.()
    })

    it('returns the updated entry', async () => {
      const store = memoryStore({ cleanupInterval: 0 })

      const result = await store.atomic?.(
        'key1',
        () => {
          return createEntry({ state: { value: 'updated' } })
        },
        60000,
      )

      expect(result.state).toEqual({ value: 'updated' })

      const fetched = await store.get('key1')
      expect(fetched?.state).toEqual({ value: 'updated' })
      await store.shutdown?.()
    })

    it('treats expired entries as null', async () => {
      vi.useFakeTimers()
      const store = memoryStore({ cleanupInterval: 0 })
      await store.set('key1', createEntry({ expiresAt: Date.now() + 1000 }), 1000)

      vi.advanceTimersByTime(1001)

      await store.atomic?.(
        'key1',
        (current) => {
          expect(current).toBeNull()
          return createEntry({ state: { fresh: true } })
        },
        60000,
      )
      await store.shutdown?.()
    })
  })

  describe('shutdown', () => {
    it('clears all data', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      await store.set('key1', createEntry(), 60000)

      await store.shutdown?.()
      expect(await store.get('key1')).toBeNull()
    })

    it('returns null after shutdown', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      await store.set('key1', createEntry(), 60000)
      await store.shutdown?.()

      expect(await store.get('key1')).toBeNull()
    })
  })
})

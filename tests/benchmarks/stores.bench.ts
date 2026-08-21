import { beforeEach, bench, describe } from 'vitest'
import type { Store, StoreEntry } from '../../src/core/types.js'
import { memoryStore } from '../../src/stores/memory.js'

function makeEntry(overrides?: Partial<StoreEntry>): StoreEntry {
  const now = Date.now()
  return {
    state: { count: 42, windowStart: now },
    expiresAt: now + 60_000,
    createdAt: now,
    ...overrides,
  }
}

describe('Memory Store', () => {
  let store: Store

  beforeEach(async () => {
    // Use cleanupInterval: 0 (serverless mode) to avoid timer interference
    store = memoryStore({ cleanupInterval: 0 })

    // Pre-populate with baseline data for benchmarks that need existing entries
    for (let i = 0; i < 100; i++) {
      await store.set(`preload-${i}`, makeEntry(), 60_000)
    }
  })

  // ─── get ───────────────────────────────────────────────────────────────────

  describe('get', () => {
    bench('existing key', async () => {
      await store.get('preload-50')
    })

    bench('non-existent key', async () => {
      await store.get('missing-key')
    })
  })

  // ─── set ───────────────────────────────────────────────────────────────────

  describe('set', () => {
    let counter = 0

    bench('new entry', async () => {
      await store.set(`bench-set-${counter++}`, makeEntry(), 60_000)
    })

    bench('overwrite existing entry', async () => {
      await store.set('preload-50', makeEntry(), 60_000)
    })
  })

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    bench('existing key', async () => {
      // Re-set before delete so there's always something to delete
      await store.set('delete-target', makeEntry(), 60_000)
      await store.delete('delete-target')
    })

    bench('non-existent key', async () => {
      await store.delete('does-not-exist')
    })
  })

  // ─── atomic ────────────────────────────────────────────────────────────────

  describe('atomic', () => {
    bench('read-modify-write on existing key', async () => {
      await store.atomic?.(
        'preload-50',
        (current) => {
          const state = (current?.state ?? { count: 0 }) as { count: number; windowStart: number }
          return {
            state: { count: state.count + 1, windowStart: state.windowStart },
            expiresAt: (current?.expiresAt ?? Date.now()) + 60_000,
            createdAt: current?.createdAt ?? Date.now(),
          }
        },
        60_000,
      )
    })

    bench('read-modify-write on new key', async () => {
      let counter = 0
      await store.atomic?.(`atomic-new-${counter++}`, (_current) => makeEntry(), 60_000)
    })
  })

  // ─── Compound operations ───────────────────────────────────────────────────

  describe('compound operations', () => {
    bench('set + get roundtrip', async () => {
      const entry = makeEntry()
      await store.set('roundtrip-key', entry, 60_000)
      await store.get('roundtrip-key')
    })

    bench('set + get + delete cycle', async () => {
      const entry = makeEntry()
      await store.set('cycle-key', entry, 60_000)
      await store.get('cycle-key')
      await store.delete('cycle-key')
    })

    bench('sequential set (100 entries)', async () => {
      for (let i = 0; i < 100; i++) {
        await store.set(`seq-${i}`, makeEntry(), 60_000)
      }
    })

    bench('sequential get (100 entries)', async () => {
      for (let i = 0; i < 100; i++) {
        await store.get(`preload-${i}`)
      }
    })
  })

  // ─── LRU eviction ─────────────────────────────────────────────────────────

  describe('LRU eviction', () => {
    let evictStore: Store

    beforeEach(() => {
      evictStore = memoryStore({ maxEntries: 100, cleanupInterval: 0 })
    })

    bench('set with eviction pressure', async () => {
      // Fill to capacity then keep adding (triggers LRU eviction each time)
      for (let i = 0; i < 110; i++) {
        await evictStore.set(`evict-${i}`, makeEntry(), 60_000)
      }
    })
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import type { Store, StoreEntry } from '../../src/core/types.js'
import { memoryStore } from '../../src/stores/memory.js'

function makeEntry(overrides: Partial<StoreEntry> = {}): StoreEntry {
  return {
    state: { count: 1 },
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
    ...overrides,
  }
}

export interface ConformanceOptions {
  /**
   * Whether the store guarantees strict serialization of concurrent atomic operations.
   * - true: expect exactly 10 increments from 10 concurrent atomic calls (memory, CAS with retries, real DB)
   * - false: expect at least 1 increment (mocked SQL stores without real row locking)
   * Default: true
   */
  strictConcurrency?: boolean | undefined
}

export function runStoreConformanceTests(
  name: string,
  createStore: () => Store | Promise<Store>,
  options: ConformanceOptions = {},
): void {
  const { strictConcurrency = true } = options
  describe(`Store Conformance: ${name}`, () => {
    let store: Store

    afterEach(async () => {
      if (store) {
        await store.clear()
        if (store.shutdown) {
          await store.shutdown()
        }
      }
    })

    it('returns null for missing key', async () => {
      store = await createStore()
      const result = await store.get('nonexistent')
      expect(result).toBeNull()
    })

    it('sets and gets a value', async () => {
      store = await createStore()
      const entry = makeEntry({ state: { count: 42 } })
      await store.set('key1', entry, 60_000)

      const result = await store.get('key1')
      expect(result).not.toBeNull()
      expect(result?.state).toEqual({ count: 42 })
      expect(result?.expiresAt).toBe(entry.expiresAt)
      expect(result?.createdAt).toBe(entry.createdAt)
    })

    it('respects TTL - expired entries return null', async () => {
      store = await createStore()
      const entry = makeEntry({ expiresAt: Date.now() - 1000 })
      await store.set('expired-key', entry, 1) // 1ms TTL

      // Wait a bit for TTL to take effect
      await new Promise<void>((resolve) => {
        const id = globalThis.setTimeout(() => resolve(), 50)
        void id
      })

      const result = await store.get('expired-key')
      expect(result).toBeNull()
    })

    it('deletes a key', async () => {
      store = await createStore()
      const entry = makeEntry()
      await store.set('to-delete', entry, 60_000)

      await store.delete('to-delete')

      const result = await store.get('to-delete')
      expect(result).toBeNull()
    })

    it('delete on nonexistent key does not throw', async () => {
      store = await createStore()
      await expect(store.delete('nonexistent')).resolves.toBeUndefined()
    })

    it('clears all keys', async () => {
      store = await createStore()
      await store.set('k1', makeEntry(), 60_000)
      await store.set('k2', makeEntry(), 60_000)
      await store.set('k3', makeEntry(), 60_000)

      await store.clear()

      expect(await store.get('k1')).toBeNull()
      expect(await store.get('k2')).toBeNull()
      expect(await store.get('k3')).toBeNull()
    })

    it('handles multiple keys independently', async () => {
      store = await createStore()
      const entry1 = makeEntry({ state: { value: 'one' } })
      const entry2 = makeEntry({ state: { value: 'two' } })

      await store.set('first', entry1, 60_000)
      await store.set('second', entry2, 60_000)

      const r1 = await store.get('first')
      const r2 = await store.get('second')

      expect(r1?.state).toEqual({ value: 'one' })
      expect(r2?.state).toEqual({ value: 'two' })
    })

    it('overwrites existing keys', async () => {
      store = await createStore()
      const entry1 = makeEntry({ state: { version: 1 } })
      const entry2 = makeEntry({ state: { version: 2 } })

      await store.set('overwrite', entry1, 60_000)
      await store.set('overwrite', entry2, 60_000)

      const result = await store.get('overwrite')
      expect(result?.state).toEqual({ version: 2 })
    })

    it('atomic: creates new entry when key does not exist', async () => {
      store = await createStore()
      if (!store.atomic) return

      const result = await store.atomic(
        'new-atomic',
        (current) => {
          expect(current).toBeNull()
          return makeEntry({ state: { created: true } })
        },
        60_000,
      )

      expect(result.state).toEqual({ created: true })

      const stored = await store.get('new-atomic')
      expect(stored).not.toBeNull()
      expect(stored?.state).toEqual({ created: true })
    })

    it('atomic: modifies existing entry', async () => {
      store = await createStore()
      if (!store.atomic) return

      const initial = makeEntry({ state: { count: 5 } })
      await store.set('modify-atomic', initial, 60_000)

      const result = await store.atomic(
        'modify-atomic',
        (current) => {
          const count = (current?.state?.count as number) ?? 0
          return makeEntry({ state: { count: count + 1 } })
        },
        60_000,
      )

      expect(result.state).toEqual({ count: 6 })

      const stored = await store.get('modify-atomic')
      expect(stored?.state).toEqual({ count: 6 })
    })

    it('atomic: concurrent access produces consistent results', async () => {
      store = await createStore()
      if (!store.atomic) return

      // Initialize with count 0
      await store.set('concurrent', makeEntry({ state: { count: 0 } }), 60_000)

      // Run 10 concurrent increments
      const promises = Array.from({ length: 10 }, () =>
        store.atomic?.(
          'concurrent',
          (current) => {
            const count = (current?.state?.count as number) ?? 0
            return makeEntry({ state: { count: count + 1 } })
          },
          60_000,
        ),
      )

      await Promise.all(promises)

      const final = await store.get('concurrent')
      expect(final).not.toBeNull()
      // For stores with proper serialization (memory, CAS-based, real DB with FOR UPDATE),
      // this should be exactly 10. For mocked SQL stores without row locking, at least 1.
      if (strictConcurrency) {
        expect(final?.state.count as number).toBe(10)
      } else {
        expect(final?.state.count as number).toBeGreaterThanOrEqual(1)
      }
    })

    it('shutdown does not throw', async () => {
      store = await createStore()
      if (!store.shutdown) return
      await expect(store.shutdown()).resolves.toBeUndefined()
    })
  })
}

// ─── Run conformance tests for memory store ──────────────────────────────────

runStoreConformanceTests('MemoryStore', () => memoryStore())

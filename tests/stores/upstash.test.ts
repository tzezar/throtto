import { beforeEach, describe, expect, it } from 'vitest'
import type { UpstashRedisClient } from '../../src/stores/upstash.js'
import { upstashStore } from '../../src/stores/upstash.js'
import { runStoreConformanceTests } from './store-conformance.test.js'

// ─── Mock Upstash Client ─────────────────────────────────────────────────────

interface MockEntry {
  value: string
  expiresAt: number | null
}

function createMockUpstashClient(options?: {
  autoParse?: boolean
}): UpstashRedisClient & { _store: Map<string, MockEntry> } {
  const store = new Map<string, MockEntry>()
  const autoParse = options?.autoParse ?? false

  function isExpired(entry: MockEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() >= entry.expiresAt
  }

  function getValid(key: string): string | null {
    const entry = store.get(key)
    if (!entry) return null
    if (isExpired(entry)) {
      store.delete(key)
      return null
    }
    return entry.value
  }

  const client: UpstashRedisClient & { _store: Map<string, MockEntry> } = {
    _store: store,

    async get<T = unknown>(key: string): Promise<T | null> {
      const raw = getValid(key)
      if (raw === null) return null

      if (autoParse) {
        try {
          return JSON.parse(raw) as T
        } catch {
          return raw as unknown as T
        }
      }

      return raw as unknown as T
    },

    async set(
      key: string,
      value: string,
      opts?: { px?: number | undefined },
    ): Promise<string | null> {
      let expiresAt: number | null = null
      if (opts?.px) {
        expiresAt = Date.now() + opts.px
      }
      store.set(key, { value, expiresAt })
      return 'OK'
    },

    async del(...keys: string[]): Promise<number> {
      let count = 0
      for (const key of keys) {
        if (store.delete(key)) count++
      }
      return count
    },

    async eval<T = unknown>(script: string, keys: string[], args: (string | number)[]): Promise<T> {
      // Simulate CAS Lua script behavior
      if (script.includes('expected') && script.includes('SET') && script.includes('PX')) {
        const key = keys[0]!
        const expected = String(args[0])
        const newValue = String(args[1])
        const ttlMs = Number(args[2])

        const current = getValid(key)

        if (expected === '') {
          if (current === null) {
            store.set(key, { value: newValue, expiresAt: Date.now() + ttlMs })
            return 1 as unknown as T
          }
          return 0 as unknown as T
        }
        if (current === expected) {
          store.set(key, { value: newValue, expiresAt: Date.now() + ttlMs })
          return 1 as unknown as T
        }
        return 0 as unknown as T
      }

      return null as unknown as T
    },

    async keys(pattern: string): Promise<string[]> {
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
      const result: string[] = []
      for (const [key, entry] of store) {
        if (key.startsWith(prefix) && !isExpired(entry)) {
          result.push(key)
        }
      }
      return result
    },
  }

  return client
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe('Upstash Store', () => {
  let mockClient: ReturnType<typeof createMockUpstashClient>

  beforeEach(() => {
    mockClient = createMockUpstashClient()
  })

  describe('basic operations', () => {
    it('get returns null for missing key', async () => {
      const store = upstashStore({ client: mockClient })
      const result = await store.get('missing')
      expect(result).toBeNull()
    })

    it('set + get roundtrip works', async () => {
      const store = upstashStore({ client: mockClient })
      const entry = {
        state: { count: 42 },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('key1', entry, 60_000)
      const result = await store.get('key1')

      expect(result).not.toBeNull()
      expect(result?.state).toEqual({ count: 42 })
      expect(result?.expiresAt).toBe(entry.expiresAt)
      expect(result?.createdAt).toBe(entry.createdAt)
    })

    it('delete removes key', async () => {
      const store = upstashStore({ client: mockClient })
      const entry = {
        state: { x: 1 },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('del-me', entry, 60_000)
      await store.delete('del-me')

      const result = await store.get('del-me')
      expect(result).toBeNull()
    })

    it('clear removes all prefixed keys', async () => {
      const store = upstashStore({ client: mockClient })
      const entry = {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('a', entry, 60_000)
      await store.set('b', entry, 60_000)
      await store.clear()

      expect(await store.get('a')).toBeNull()
      expect(await store.get('b')).toBeNull()
    })

    it('clear does nothing when no keys exist', async () => {
      const store = upstashStore({ client: mockClient })
      await expect(store.clear()).resolves.toBeUndefined()
    })
  })

  describe('key prefixing', () => {
    it('default prefix is throtto:', async () => {
      const store = upstashStore({ client: mockClient })
      const entry = {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('mykey', entry, 60_000)
      expect(mockClient._store.has('throtto:mykey')).toBe(true)
    })

    it('custom prefix works', async () => {
      const store = upstashStore({ client: mockClient, prefix: 'edge:' })
      const entry = {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('key', entry, 60_000)
      expect(mockClient._store.has('edge:key')).toBe(true)
    })

    it('clear only removes keys with configured prefix', async () => {
      const store = upstashStore({ client: mockClient, prefix: 'app1:' })
      const entry = {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      mockClient._store.set('other:key', { value: '{}', expiresAt: null })

      await store.set('mykey', entry, 60_000)
      await store.clear()

      expect(mockClient._store.has('app1:mykey')).toBe(false)
      expect(mockClient._store.has('other:key')).toBe(true)
    })
  })

  describe('auto-deserialization handling', () => {
    it('works when get() returns a string', async () => {
      const store = upstashStore({ client: mockClient })
      const entry = {
        state: { mode: 'string' },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('str-key', entry, 60_000)
      const result = await store.get('str-key')

      expect(result).not.toBeNull()
      expect(result?.state).toEqual({ mode: 'string' })
    })

    it('works when get() returns pre-parsed object', async () => {
      const autoParseMock = createMockUpstashClient({ autoParse: true })
      const store = upstashStore({ client: autoParseMock })
      const entry = {
        state: { mode: 'object' },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('obj-key', entry, 60_000)
      const result = await store.get('obj-key')

      expect(result).not.toBeNull()
      expect(result?.state).toEqual({ mode: 'object' })
    })
  })

  describe('atomic operations', () => {
    it('creates entry when none exists', async () => {
      const store = upstashStore({ client: mockClient })
      const result = await store.atomic?.(
        'new-key',
        (current) => {
          expect(current).toBeNull()
          return {
            state: { initialized: true },
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
          }
        },
        60_000,
      )

      expect(result.state).toEqual({ initialized: true })

      const stored = await store.get('new-key')
      expect(stored?.state).toEqual({ initialized: true })
    })

    it('modifies existing entry', async () => {
      const store = upstashStore({ client: mockClient })
      const initial = {
        state: { count: 5 },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('counter', initial, 60_000)

      const result = await store.atomic?.(
        'counter',
        (current) => ({
          state: { count: ((current?.state?.count as number) ?? 0) + 1 },
          expiresAt: Date.now() + 60_000,
          createdAt: current?.createdAt ?? Date.now(),
        }),
        60_000,
      )

      expect(result.state).toEqual({ count: 6 })
    })

    it('handles concurrent access', async () => {
      const store = upstashStore({ client: mockClient })
      const initial = {
        state: { count: 0 },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('contended', initial, 60_000)

      const promises = Array.from({ length: 5 }, () =>
        store.atomic?.(
          'contended',
          (current) => ({
            state: { count: ((current?.state?.count as number) ?? 0) + 1 },
            expiresAt: Date.now() + 60_000,
            createdAt: current?.createdAt ?? Date.now(),
          }),
          60_000,
        ),
      )

      await Promise.all(promises)

      const final = await store.get('contended')
      expect(final).not.toBeNull()
      expect(final?.state.count as number).toBe(5)
    })
  })

  describe('shutdown', () => {
    it('does not throw (no-op for HTTP client)', async () => {
      const store = upstashStore({ client: mockClient })
      await expect(store.shutdown?.()).resolves.toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('handles malformed data gracefully', async () => {
      const store = upstashStore({ client: mockClient })
      mockClient._store.set('throtto:bad', { value: 'not-json{{{', expiresAt: null })

      const result = await store.get('bad')
      expect(result).toBeNull()
    })

    it('handles missing fields in stored entry', async () => {
      const store = upstashStore({ client: mockClient })
      mockClient._store.set('throtto:partial', {
        value: JSON.stringify({ state: { x: 1 } }),
        expiresAt: null,
      })

      const result = await store.get('partial')
      expect(result).toBeNull()
    })
  })
})

// ─── Conformance Tests ───────────────────────────────────────────────────────

runStoreConformanceTests('UpstashStore (mocked)', () =>
  upstashStore({ client: createMockUpstashClient(), prefix: 'conformance:' }),
)

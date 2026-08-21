import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedisClient } from '../../src/stores/redis.js'
import { redisStore } from '../../src/stores/redis.js'
import { runStoreConformanceTests } from './store-conformance.test.js'

// ─── Mock Redis Client ───────────────────────────────────────────────────────

interface MockEntry {
  value: string
  expiresAt: number | null
}

function createMockRedisClient(): RedisClient & { _store: Map<string, MockEntry> } {
  const store = new Map<string, MockEntry>()

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

  const client: RedisClient & { _store: Map<string, MockEntry> } = {
    _store: store,

    async get(key: string): Promise<string | null> {
      return getValid(key)
    },

    async set(key: string, value: string, ...args: (string | number)[]): Promise<unknown> {
      let expiresAt: number | null = null

      // Parse PX argument
      for (let i = 0; i < args.length; i++) {
        if (String(args[i]).toUpperCase() === 'PX' && i + 1 < args.length) {
          const ttl = Number(args[i + 1])
          expiresAt = Date.now() + ttl
          break
        }
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

    async eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown> {
      // Simulate CAS Lua script behavior
      const keys = args.slice(0, numkeys).map(String)
      const argv = args.slice(numkeys).map(String)

      // Detect CAS script by checking for ARGV pattern
      if (script.includes('expected') && script.includes('SET') && script.includes('PX')) {
        const key = keys[0]!
        const expected = argv[0]!
        const newValue = argv[1]!
        const ttlMs = Number(argv[2])

        const current = getValid(key)

        if (expected === '') {
          // Expecting key doesn't exist
          if (current === null) {
            store.set(key, { value: newValue, expiresAt: Date.now() + ttlMs })
            return [1, '']
          }
          return [0, current]
        }
        // Expecting specific value
        if (current === expected) {
          store.set(key, { value: newValue, expiresAt: Date.now() + ttlMs })
          return [1, '']
        }
        return [0, current ?? '']
      }

      // Simulate PING
      if (script.includes('PING')) {
        return 'PONG'
      }

      return null
    },

    async evalsha(sha: string, numkeys: number, ...args: (string | number)[]): Promise<unknown> {
      // Not used in current implementation, delegate to eval
      return client.eval('', numkeys, ...args)
    },

    async quit(): Promise<unknown> {
      return 'OK'
    },
  }

  return client
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe('Redis Store', () => {
  let mockClient: ReturnType<typeof createMockRedisClient>

  beforeEach(() => {
    mockClient = createMockRedisClient()
  })

  describe('basic operations', () => {
    it('get returns null for missing key', async () => {
      const store = redisStore({ client: mockClient })
      const result = await store.get('missing')
      expect(result).toBeNull()
    })

    it('set + get roundtrip works', async () => {
      const store = redisStore({ client: mockClient })
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
      const store = redisStore({ client: mockClient })
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
      const store = redisStore({ client: mockClient })
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
      const store = redisStore({ client: mockClient })
      await expect(store.clear()).resolves.toBeUndefined()
    })
  })

  describe('key prefixing', () => {
    it('default prefix is throtto:', async () => {
      const store = redisStore({ client: mockClient })
      const entry = {
        state: { prefixed: true },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('mykey', entry, 60_000)

      // Verify the actual key in the mock store
      expect(mockClient._store.has('throtto:mykey')).toBe(true)
    })

    it('custom prefix works', async () => {
      const store = redisStore({ client: mockClient, prefix: 'custom:' })
      const entry = {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('key', entry, 60_000)
      expect(mockClient._store.has('custom:key')).toBe(true)
    })

    it('clear only removes keys with configured prefix', async () => {
      const store = redisStore({ client: mockClient, prefix: 'app1:' })
      const entry = {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      // Manually put a key with different prefix
      mockClient._store.set('other:key', { value: '{}', expiresAt: null })

      await store.set('mykey', entry, 60_000)
      await store.clear()

      // Our key should be gone
      expect(mockClient._store.has('app1:mykey')).toBe(false)
      // Other prefix key should still exist
      expect(mockClient._store.has('other:key')).toBe(true)
    })
  })

  describe('TTL handling', () => {
    it('set passes PX with correct TTL', async () => {
      const setSpy = vi.spyOn(mockClient, 'set')
      const store = redisStore({ client: mockClient })
      const entry = {
        state: {},
        expiresAt: Date.now() + 30_000,
        createdAt: Date.now(),
      }

      await store.set('ttl-key', entry, 30_000)

      expect(setSpy).toHaveBeenCalledWith('throtto:ttl-key', expect.any(String), 'PX', 30_000)
    })

    it('expired entries return null on get', async () => {
      const store = redisStore({ client: mockClient })
      const entry = {
        state: { old: true },
        expiresAt: Date.now() - 1000, // Already expired
        createdAt: Date.now() - 5000,
      }

      // Manually insert (bypass TTL) to simulate stale data
      mockClient._store.set('throtto:stale', {
        value: JSON.stringify(entry),
        expiresAt: null, // No Redis-level expiry to test our safety check
      })

      const result = await store.get('stale')
      expect(result).toBeNull()
    })
  })

  describe('atomic operations', () => {
    it('creates entry when none exists', async () => {
      const store = redisStore({ client: mockClient })
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
      const store = redisStore({ client: mockClient })
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

    it('handles concurrent access via CAS retries', async () => {
      const store = redisStore({ client: mockClient })
      const initial = {
        state: { count: 0 },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }

      await store.set('contended', initial, 60_000)

      // Run multiple concurrent atomics
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
    it('calls client.quit() when disconnectOnShutdown is true', async () => {
      const quitSpy = vi.spyOn(mockClient, 'quit')
      const store = redisStore({ client: mockClient, disconnectOnShutdown: true })

      await store.shutdown?.()

      expect(quitSpy).toHaveBeenCalled()
    })

    it('does not call quit when disconnectOnShutdown is false', async () => {
      const quitSpy = vi.spyOn(mockClient, 'quit')
      const store = redisStore({ client: mockClient, disconnectOnShutdown: false })

      await store.shutdown?.()

      expect(quitSpy).not.toHaveBeenCalled()
    })

    it('handles client without quit method', async () => {
      const clientWithoutQuit: RedisClient = {
        get: mockClient.get.bind(mockClient),
        set: mockClient.set.bind(mockClient),
        del: mockClient.del.bind(mockClient),
        keys: mockClient.keys.bind(mockClient),
        eval: mockClient.eval.bind(mockClient),
        evalsha: mockClient.evalsha?.bind(mockClient),
      }

      const store = redisStore({ client: clientWithoutQuit, disconnectOnShutdown: true })
      await expect(store.shutdown?.()).resolves.toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('handles malformed JSON gracefully', async () => {
      const store = redisStore({ client: mockClient })
      mockClient._store.set('throtto:bad-json', { value: 'not-json{{{', expiresAt: null })

      const result = await store.get('bad-json')
      expect(result).toBeNull()
    })

    it('handles missing fields in stored entry', async () => {
      const store = redisStore({ client: mockClient })
      mockClient._store.set('throtto:partial', {
        value: JSON.stringify({ state: { x: 1 } }), // missing expiresAt, createdAt
        expiresAt: null,
      })

      const result = await store.get('partial')
      expect(result).toBeNull()
    })
  })
})

// ─── Conformance Tests ───────────────────────────────────────────────────────

runStoreConformanceTests('RedisStore (mocked)', () =>
  redisStore({ client: createMockRedisClient(), prefix: 'conformance:' }),
)

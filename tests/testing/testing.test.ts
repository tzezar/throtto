import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Limiter, RateLimitResult } from '../../src/core/types.js'
import { testClock } from '../../src/testing/clock.js'
import { assertAllowed, assertDenied, exhaust } from '../../src/testing/helpers.js'
import { mockStore } from '../../src/testing/mock-store.js'

// ─── testClock ────────────────────────────────────────────────────────────────

describe('testClock', () => {
  it('creates with default time of 1_000_000_000_000', () => {
    const clock = testClock()
    expect(clock.now()).toBe(1_000_000_000_000)
  })

  it('creates with custom initial time', () => {
    const clock = testClock(5000)
    expect(clock.now()).toBe(5000)
  })

  it('now() returns current time', () => {
    const clock = testClock(42)
    expect(clock.now()).toBe(42)
    // Calling now() multiple times without changes should return the same value
    expect(clock.now()).toBe(42)
  })

  it('advance(ms) moves time forward', () => {
    const clock = testClock(1000)
    clock.advance(500)
    expect(clock.now()).toBe(1500)
  })

  it('set(timestamp) sets absolute time', () => {
    const clock = testClock(1000)
    clock.set(9999)
    expect(clock.now()).toBe(9999)
  })

  it('tick() advances by 1ms', () => {
    const clock = testClock(1000)
    clock.tick()
    expect(clock.now()).toBe(1001)
  })

  it('tick(ms) advances by given ms', () => {
    const clock = testClock(1000)
    clock.tick(50)
    expect(clock.now()).toBe(1050)
  })

  it('multiple advances accumulate', () => {
    const clock = testClock(0)
    clock.advance(100)
    clock.advance(200)
    clock.tick()
    clock.tick(10)
    expect(clock.now()).toBe(311)
  })
})

// ─── mockStore ────────────────────────────────────────────────────────────────

describe('mockStore', () => {
  const sampleEntry = {
    state: { count: 5 },
    expiresAt: Date.now() + 60000,
    createdAt: Date.now(),
  }

  describe('basic operations', () => {
    it('get returns null for non-existent keys', async () => {
      const store = mockStore()
      const result = await store.get('missing-key')
      expect(result).toBeNull()
    })

    it('set and get work correctly', async () => {
      const store = mockStore()
      await store.set('key1', sampleEntry, 60000)
      const result = await store.get('key1')
      expect(result).toEqual(sampleEntry)
    })

    it('delete removes an entry', async () => {
      const store = mockStore()
      await store.set('key1', sampleEntry, 60000)
      await store.delete('key1')
      const result = await store.get('key1')
      expect(result).toBeNull()
    })

    it('clear removes all entries', async () => {
      const store = mockStore()
      await store.set('key1', sampleEntry, 60000)
      await store.set('key2', sampleEntry, 60000)
      await store.clear()
      expect(await store.get('key1')).toBeNull()
      expect(await store.get('key2')).toBeNull()
    })
  })

  describe('call tracking', () => {
    it('tracks calls in calls array', async () => {
      const store = mockStore()
      await store.set('k', sampleEntry, 5000)
      await store.get('k')

      expect(store.calls).toHaveLength(2)
      expect(store.calls[0]?.method).toBe('set')
      expect(store.calls[0]?.args).toEqual(['k', sampleEntry, 5000])
      expect(store.calls[1]?.method).toBe('get')
      expect(store.calls[1]?.args).toEqual(['k'])
    })

    it('getCallCount returns correct count', async () => {
      const store = mockStore()
      await store.get('a')
      await store.get('b')
      await store.set('c', sampleEntry, 1000)

      expect(store.getCallCount('get')).toBe(2)
      expect(store.getCallCount('set')).toBe(1)
      expect(store.getCallCount('delete')).toBe(0)
    })
  })

  describe('reset', () => {
    it('clears call history but keeps entries', async () => {
      const store = mockStore()
      await store.set('key1', sampleEntry, 60000)
      expect(store.calls).toHaveLength(1)

      store.reset()

      expect(store.calls).toHaveLength(0)
      expect(store.getCallCount('set')).toBe(0)
      // Entry should still be accessible
      const result = await store.get('key1')
      expect(result).toEqual(sampleEntry)
    })
  })

  describe('failOn', () => {
    it('makes specified methods always throw', async () => {
      const store = mockStore({ failOn: ['get', 'set'] })

      await expect(store.get('key')).rejects.toThrow('MockStore: configured to fail on get')
      await expect(store.set('key', sampleEntry, 1000)).rejects.toThrow(
        'MockStore: configured to fail on set',
      )
      // delete is not in failOn, so it should succeed
      await expect(store.delete('key')).resolves.toBeUndefined()
    })
  })

  describe('failAfter', () => {
    it('fails after N total operations', async () => {
      const store = mockStore({ failAfter: 2 })

      // First two operations succeed
      await store.get('a')
      await store.get('b')

      // Third operation fails
      await expect(store.get('c')).rejects.toThrow('MockStore: failing after 2 operations')
    })
  })

  describe('failNext', () => {
    it('makes only the next call of that method fail', async () => {
      const store = mockStore()
      store.failNext('get')

      // First get fails
      await expect(store.get('key')).rejects.toThrow('MockStore: injected failure on get')

      // Subsequent gets succeed
      await expect(store.get('key')).resolves.toBeNull()
    })
  })

  describe('latencyMs', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('introduces delay on operations', async () => {
      const store = mockStore({ latencyMs: 100 })

      const promise = store.get('key')
      let resolved = false
      promise.then(() => {
        resolved = true
      })

      // Should not be resolved yet
      await vi.advanceTimersByTimeAsync(50)
      expect(resolved).toBe(false)

      // After enough time passes, it resolves
      await vi.advanceTimersByTimeAsync(50)
      expect(resolved).toBe(true)

      const result = await promise
      expect(result).toBeNull()
    })
  })

  describe('atomic', () => {
    it('performs read-modify-write correctly', async () => {
      const store = mockStore()

      // atomic on a non-existent key passes null to updater
      const result = await store.atomic?.(
        'counter',
        (current) => {
          expect(current).toBeNull()
          return { state: { count: 1 }, expiresAt: 99999, createdAt: 10000 }
        },
        60000,
      )

      expect(result).toEqual({ state: { count: 1 }, expiresAt: 99999, createdAt: 10000 })

      // atomic on existing key passes current entry to updater
      const result2 = await store.atomic?.(
        'counter',
        (current) => {
          expect(current).toEqual({ state: { count: 1 }, expiresAt: 99999, createdAt: 10000 })
          return {
            state: { count: (current?.state as { count: number }).count + 1 },
            expiresAt: 99999,
            createdAt: 10000,
          }
        },
        60000,
      )

      expect(result2.state).toEqual({ count: 2 })
    })
  })

  describe('shutdown', () => {
    it('clears entries', async () => {
      const store = mockStore()
      await store.set('key1', sampleEntry, 60000)
      await store.shutdown?.()
      // After shutdown, entries are cleared
      // Need to reset to be able to get (shutdown clears entries, but doesn't fail future ops)
      store.reset()
      const result = await store.get('key1')
      expect(result).toBeNull()
    })
  })
})

// ─── helpers ──────────────────────────────────────────────────────────────────

describe('helpers', () => {
  const allowedResult: RateLimitResult = {
    allowed: true,
    limit: 10,
    remaining: 9,
    resetAt: Date.now() + 60000,
    cost: 1,
  }

  const deniedResult: RateLimitResult = {
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: Date.now() + 60000,
    retryAfter: 5000,
    cost: 1,
  }

  describe('assertAllowed', () => {
    it('passes for allowed results', () => {
      expect(() => assertAllowed(allowedResult)).not.toThrow()
    })

    it('throws for denied results', () => {
      expect(() => assertDenied(allowedResult)).toThrow(
        /Expected result to be denied, but was allowed/,
      )
    })
  })

  describe('assertDenied', () => {
    it('passes for denied results', () => {
      expect(() => assertDenied(deniedResult)).not.toThrow()
    })

    it('throws for allowed results', () => {
      expect(() => assertAllowed(deniedResult)).toThrow(
        /Expected result to be allowed, but was denied/,
      )
    })
  })

  describe('exhaust', () => {
    it('calls limiter.check N times and returns all results', async () => {
      const mockLimiter = {
        check: vi.fn().mockResolvedValue({
          allowed: true,
          limit: 10,
          remaining: 9,
          resetAt: Date.now() + 60000,
          cost: 1,
        }),
        consume: vi.fn(),
        peek: vi.fn(),
        reset: vi.fn(),
        shutdown: vi.fn(),
      } as unknown as Limiter

      const results = await exhaust(mockLimiter, 'user:123', 5)

      expect(mockLimiter.check).toHaveBeenCalledTimes(5)
      expect(mockLimiter.check).toHaveBeenCalledWith('user:123')
      for (const r of results) {
        expect(r.allowed).toBe(true)
      }
    })

    it('returns array of correct length', async () => {
      let callCount = 0
      const mockLimiter = {
        check: vi.fn().mockImplementation(async () => {
          callCount++
          return callCount <= 3
            ? {
                allowed: true,
                limit: 3,
                remaining: 3 - callCount,
                resetAt: Date.now() + 60000,
                cost: 1,
              }
            : {
                allowed: false,
                limit: 3,
                remaining: 0,
                resetAt: Date.now() + 60000,
                retryAfter: 1000,
                cost: 1,
              }
        }),
        consume: vi.fn(),
        peek: vi.fn(),
        reset: vi.fn(),
        shutdown: vi.fn(),
      } as unknown as Limiter

      const results = await exhaust(mockLimiter, 'key', 5)

      expect(results).toHaveLength(5)
      expect(results[0]?.allowed).toBe(true)
      expect(results[2]?.allowed).toBe(true)
      expect(results[3]?.allowed).toBe(false)
      expect(results[4]?.allowed).toBe(false)
    })
  })
})

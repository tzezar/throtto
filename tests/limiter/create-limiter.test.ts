import { describe, expect, it, vi } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { tokenBucket } from '../../src/algorithms/token-bucket.js'
import { createClock } from '../../src/core/clock.js'
import { RateLimitExceededError } from '../../src/core/errors.js'
import type { Store, StoreEntry } from '../../src/core/types.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createLimiter', () => {
  describe('check()', () => {
    it('allows requests within limit', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
      expect(result.limit).toBe(5)
      await limiter.shutdown()
    })

    it('denies requests over limit', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 2, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      await limiter.check('user:1')
      await limiter.check('user:1')
      const result = await limiter.check('user:1')

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      await limiter.shutdown()
    })

    it('tracks different keys independently', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 1, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      const r1 = await limiter.check('user:1')
      const r2 = await limiter.check('user:2')
      expect(r1.allowed).toBe(true)
      expect(r2.allowed).toBe(true)

      const r3 = await limiter.check('user:1')
      expect(r3.allowed).toBe(false)
      await limiter.shutdown()
    })

    it('uses injectable clock', async () => {
      let time = Date.now()
      const clock = createClock(() => time)

      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 1, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
        clock,
      })

      await limiter.check('user:1')
      const denied = await limiter.check('user:1')
      expect(denied.allowed).toBe(false)

      // Advance time past window
      time += 61000
      const allowed = await limiter.check('user:1')
      expect(allowed.allowed).toBe(true)
      await limiter.shutdown()
    })

    it('supports cost option', async () => {
      const limiter = createLimiter({
        algorithm: tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      const result = await limiter.check('user:1', { cost: 5 })
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
      await limiter.shutdown()
    })

    it('supports config-level cost', async () => {
      const limiter = createLimiter({
        algorithm: tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' }),
        store: memoryStore({ cleanupInterval: 0 }),
        cost: 3,
      })

      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(7)
      await limiter.shutdown()
    })

    it('supports prefix', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store,
        prefix: 'api:',
      })

      await limiter.check('user:1')
      // Key should be prefixed
      const entry = await store.get('api:user:1')
      expect(entry).not.toBeNull()
      await limiter.shutdown()
    })
  })

  describe('consume()', () => {
    it('returns result when allowed', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      const result = await limiter.consume('user:1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
      await limiter.shutdown()
    })

    it('throws RateLimitExceededError when denied', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 1, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      await limiter.consume('user:1')

      await expect(limiter.consume('user:1')).rejects.toThrow(RateLimitExceededError)
      await limiter.shutdown()
    })

    it('error has correct properties', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 1, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      await limiter.consume('user:1')

      try {
        await limiter.consume('user:1')
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitExceededError)
        const e = error as RateLimitExceededError
        expect(e.retryAfter).toBeGreaterThan(0)
        expect(e.limit).toBe(1)
      }
      await limiter.shutdown()
    })
  })

  describe('peek()', () => {
    it('returns info without consuming', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      await limiter.check('user:1')

      const info = await limiter.peek('user:1')
      expect(info).not.toBeNull()
      expect(info?.remaining).toBe(4)

      // Peek again - same
      const info2 = await limiter.peek('user:1')
      expect(info2?.remaining).toBe(4)
      await limiter.shutdown()
    })

    it('returns null for unknown key', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      const info = await limiter.peek('unknown')
      expect(info).toBeNull()
      await limiter.shutdown()
    })
  })

  describe('reset()', () => {
    it('clears rate limit state for a key', async () => {
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 1, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
      })

      await limiter.check('user:1')
      const denied = await limiter.check('user:1')
      expect(denied.allowed).toBe(false)

      await limiter.reset('user:1')

      const allowed = await limiter.check('user:1')
      expect(allowed.allowed).toBe(true)
      await limiter.shutdown()
    })
  })

  describe('hooks', () => {
    it('fires onAllow hook', async () => {
      const onAllow = vi.fn()
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
        hooks: { onAllow },
      })

      await limiter.check('user:1')
      expect(onAllow).toHaveBeenCalledTimes(1)
      expect(onAllow).toHaveBeenCalledWith('user:1', expect.objectContaining({ allowed: true }))
      await limiter.shutdown()
    })

    it('fires onDeny hook', async () => {
      const onDeny = vi.fn()
      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 1, window: '1m' }),
        store: memoryStore({ cleanupInterval: 0 }),
        hooks: { onDeny },
      })

      await limiter.check('user:1')
      await limiter.check('user:1')

      expect(onDeny).toHaveBeenCalledTimes(1)
      expect(onDeny).toHaveBeenCalledWith('user:1', expect.objectContaining({ allowed: false }))
      await limiter.shutdown()
    })
  })

  describe('graceful degradation', () => {
    it('fail-open: allows on store error', async () => {
      const brokenStore: Store = {
        get: () => Promise.reject(new Error('store down')),
        set: () => Promise.reject(new Error('store down')),
        delete: () => Promise.reject(new Error('store down')),
        clear: () => Promise.reject(new Error('store down')),
      }

      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: brokenStore,
        failMode: 'open',
      })

      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
    })

    it('fail-closed: denies on store error', async () => {
      const brokenStore: Store = {
        get: () => Promise.reject(new Error('store down')),
        set: () => Promise.reject(new Error('store down')),
        delete: () => Promise.reject(new Error('store down')),
        clear: () => Promise.reject(new Error('store down')),
      }

      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: brokenStore,
        failMode: 'closed',
      })

      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(false)
    })

    it('fires onStoreError on failure', async () => {
      const onStoreError = vi.fn()
      const brokenStore: Store = {
        get: () => Promise.reject(new Error('connection lost')),
        set: () => Promise.reject(new Error('connection lost')),
        delete: () => Promise.reject(new Error('connection lost')),
        clear: () => Promise.reject(new Error('connection lost')),
      }

      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 5, window: '1m' }),
        store: brokenStore,
        failMode: 'open',
        hooks: { onStoreError },
      })

      await limiter.check('user:1')
      expect(onStoreError).toHaveBeenCalledTimes(1)
    })

    it('uses fallback store when primary fails', async () => {
      const brokenStore: Store = {
        get: () => Promise.reject(new Error('down')),
        set: () => Promise.reject(new Error('down')),
        delete: () => Promise.reject(new Error('down')),
        clear: () => Promise.reject(new Error('down')),
      }
      const fallback = memoryStore({ cleanupInterval: 0 })

      const limiter = createLimiter({
        algorithm: fixedWindow({ limit: 2, window: '1m' }),
        store: brokenStore,
        fallbackStore: fallback,
      })

      const r1 = await limiter.check('user:1')
      expect(r1.allowed).toBe(true)

      const r2 = await limiter.check('user:1')
      expect(r2.allowed).toBe(true)

      const r3 = await limiter.check('user:1')
      expect(r3.allowed).toBe(false)
      await fallback.shutdown?.()
    })
  })
})

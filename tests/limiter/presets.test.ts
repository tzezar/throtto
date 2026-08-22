import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/core/errors.js'
import { rateLimit } from '../../src/limiter/presets.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('rateLimit presets', () => {
  describe('string format', () => {
    it('parses "100/minute"', async () => {
      const limiter = rateLimit('100/minute')
      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(100)
      await limiter.shutdown()
    })

    it('parses "10/second"', async () => {
      const limiter = rateLimit('10/second')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(10)
      await limiter.shutdown()
    })

    it('parses "1000/hour"', async () => {
      const limiter = rateLimit('1000/hour')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(1000)
      await limiter.shutdown()
    })

    it('parses short units: "50/m"', async () => {
      const limiter = rateLimit('50/m')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(50)
      await limiter.shutdown()
    })

    it('parses "5/day"', async () => {
      const limiter = rateLimit('5/day')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(5)
      await limiter.shutdown()
    })

    it('throws on invalid format', () => {
      expect(() => rateLimit('abc')).toThrow(ConfigError)
      expect(() => rateLimit('100')).toThrow(ConfigError)
      expect(() => rateLimit('/minute')).toThrow(ConfigError)
    })

    it('throws on invalid unit', () => {
      expect(() => rateLimit('100/lightyear')).toThrow(ConfigError)
    })
  })

  describe('custom duration presets', () => {
    it('parses "100/15m" (100 per 15 minutes)', async () => {
      const limiter = rateLimit('100/15m')
      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(100)
      await limiter.shutdown()
    })

    it('parses "50/30s" (50 per 30 seconds)', async () => {
      const limiter = rateLimit('50/30s')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(50)
      await limiter.shutdown()
    })

    it('parses "1000/6h" (1000 per 6 hours)', async () => {
      const limiter = rateLimit('1000/6h')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(1000)
      await limiter.shutdown()
    })

    it('parses "500/1h30m" (500 per 90 minutes)', async () => {
      const limiter = rateLimit('500/1h30m')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(500)
      await limiter.shutdown()
    })

    it('parses "10/500ms" (10 per 500ms)', async () => {
      const limiter = rateLimit('10/500ms')
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(10)
      await limiter.shutdown()
    })

    it('existing presets still work alongside custom durations', async () => {
      const l1 = rateLimit('100/minute')
      const l2 = rateLimit('100/1m')
      const r1 = await l1.check('user:1')
      const r2 = await l2.check('user:1')
      expect(r1.limit).toBe(100)
      expect(r2.limit).toBe(100)
      await l1.shutdown()
      await l2.shutdown()
    })
  })

  describe('with options', () => {
    it('accepts custom store', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      const limiter = rateLimit('10/minute', { store })

      await limiter.check('user:1')
      const entry = await store.get('user:1')
      expect(entry).not.toBeNull()
      await limiter.shutdown()
    })

    it('accepts prefix', async () => {
      const store = memoryStore({ cleanupInterval: 0 })
      const limiter = rateLimit('10/minute', { store, prefix: 'api:' })

      await limiter.check('user:1')
      const entry = await store.get('api:user:1')
      expect(entry).not.toBeNull()
      await limiter.shutdown()
    })
  })

  describe('object config', () => {
    it('accepts simple config object', async () => {
      const limiter = rateLimit({ limit: 5, window: '30s' })
      const result = await limiter.check('user:1')
      expect(result.limit).toBe(5)
      await limiter.shutdown()
    })
  })

  describe('functional limiter', () => {
    it('returned limiter enforces rate limit', async () => {
      const limiter = rateLimit('2/minute')

      await limiter.check('user:1')
      await limiter.check('user:1')
      const denied = await limiter.check('user:1')
      expect(denied.allowed).toBe(false)
      await limiter.shutdown()
    })
  })
})

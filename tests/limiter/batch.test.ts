import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { withBatch } from '../../src/limiter/batch.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withBatch', () => {
  function createTestLimiter(limit = 5) {
    return createLimiter({
      algorithm: fixedWindow({ limit, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  describe('checkMany', () => {
    it('checks multiple keys at once', async () => {
      const limiter = withBatch(createTestLimiter())

      const results = await limiter.checkMany([
        { ctx: 'user:1' },
        { ctx: 'user:2' },
        { ctx: 'user:3' },
      ])

      expect(results).toHaveLength(3)
      expect(results[0]?.allowed).toBe(true)
      expect(results[1]?.allowed).toBe(true)
      expect(results[2]?.allowed).toBe(true)
      await limiter.shutdown()
    })

    it('respects per-item cost', async () => {
      const limiter = withBatch(createTestLimiter(10))

      const results = await limiter.checkMany([
        { ctx: 'user:1', cost: 5 },
        { ctx: 'user:1', cost: 5 },
        { ctx: 'user:1', cost: 1 },
      ])

      expect(results[0]?.allowed).toBe(true)
      expect(results[1]?.allowed).toBe(true)
      expect(results[2]?.allowed).toBe(false)
      await limiter.shutdown()
    })

    it('tracks state across batch items for same key', async () => {
      const limiter = withBatch(createTestLimiter(3))

      const results = await limiter.checkMany([
        { ctx: 'user:1' },
        { ctx: 'user:1' },
        { ctx: 'user:1' },
        { ctx: 'user:1' },
      ])

      expect(results[0]?.allowed).toBe(true)
      expect(results[1]?.allowed).toBe(true)
      expect(results[2]?.allowed).toBe(true)
      expect(results[3]?.allowed).toBe(false)
      await limiter.shutdown()
    })

    it('returns empty array for empty input', async () => {
      const limiter = withBatch(createTestLimiter())
      const results = await limiter.checkMany([])
      expect(results).toEqual([])
      await limiter.shutdown()
    })
  })

  describe('regular methods still work', () => {
    it('check() works', async () => {
      const limiter = withBatch(createTestLimiter())
      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
      await limiter.shutdown()
    })

    it('peek() works', async () => {
      const limiter = withBatch(createTestLimiter())
      await limiter.check('user:1')
      const info = await limiter.peek('user:1')
      expect(info).not.toBeNull()
      await limiter.shutdown()
    })
  })
})

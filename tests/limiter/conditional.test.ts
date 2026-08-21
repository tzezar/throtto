import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { withConditional } from '../../src/limiter/conditional.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withConditional', () => {
  function createTestLimiter(limit = 5) {
    return createLimiter({
      algorithm: fixedWindow({ limit, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  describe('reserve', () => {
    it('returns allowed reservation when within limit', async () => {
      const limiter = withConditional(createTestLimiter())
      const reservation = await limiter.reserve('user:1')

      expect(reservation.allowed).toBe(true)
      expect(reservation.result.allowed).toBe(true)
      expect(reservation.expiresAt).toBeGreaterThan(Date.now())
      await limiter.shutdown()
    })

    it('returns denied reservation when over limit', async () => {
      const limiter = withConditional(createTestLimiter(1))

      await limiter.check('user:1')
      const reservation = await limiter.reserve('user:1')

      expect(reservation.allowed).toBe(false)
      await limiter.shutdown()
    })

    it('confirm() resolves without error', async () => {
      const limiter = withConditional(createTestLimiter())
      const reservation = await limiter.reserve('user:1')

      await expect(reservation.confirm()).resolves.toBeUndefined()
      await limiter.shutdown()
    })

    it('cancel() resolves without error', async () => {
      const limiter = withConditional(createTestLimiter())
      const reservation = await limiter.reserve('user:1')

      await expect(reservation.cancel()).resolves.toBeUndefined()
      await limiter.shutdown()
    })

    it('consumes capacity on reserve', async () => {
      const limiter = withConditional(createTestLimiter(2))

      await limiter.reserve('user:1')
      await limiter.reserve('user:1')

      // Both slots taken by reservations
      const r3 = await limiter.check('user:1')
      expect(r3.allowed).toBe(false)
      await limiter.shutdown()
    })
  })

  describe('check still works normally', () => {
    it('check works independently', async () => {
      const limiter = withConditional(createTestLimiter())
      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
      await limiter.shutdown()
    })
  })
})

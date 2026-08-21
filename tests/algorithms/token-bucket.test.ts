import { describe, expect, it } from 'vitest'
import { tokenBucket } from '../../src/algorithms/token-bucket.js'

describe('tokenBucket', () => {
  const now = 1000000

  describe('basic behavior', () => {
    it('starts with full bucket', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1 })
      const result = algo.check(null, now)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(9)
    })

    it('allows requests while tokens available', () => {
      const algo = tokenBucket({ capacity: 5, refillRate: 1, refillInterval: '1s' })
      let state = algo.initialState()

      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })

    it('denies when bucket is empty', () => {
      const algo = tokenBucket({ capacity: 3, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)
    })

    it('remaining decreases with each request', () => {
      const algo = tokenBucket({ capacity: 5, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      const r1 = algo.check(state, now)
      expect(r1.info.remaining).toBe(4)
      state = r1.state

      const r2 = algo.check(state, now)
      expect(r2.info.remaining).toBe(3)
    })
  })

  describe('refill', () => {
    it('refills tokens over time', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      expect(algo.check(state, now).allowed).toBe(false)

      // After 3 seconds, should have 3 tokens
      const result = algo.check(state, now + 3000)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(2) // 3 refilled - 1 consumed = 2
    })

    it('does not exceed capacity', () => {
      const algo = tokenBucket({ capacity: 5, refillRate: 2, refillInterval: '1s' })
      let state: any = null

      // Consume 2 tokens
      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now)
      state = r2.state

      // Wait long time
      const info = algo.peek?.(state, now + 100000)
      expect(info.remaining).toBe(5) // capped at capacity
    })

    it('supports fractional refill intervals', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '500ms' })
      let state: any = null

      // Consume all
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // After 1 second with 500ms interval, 2 tokens refilled
      const result = algo.check(state, now + 1000)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(1)
    })

    it('refills multiple tokens per interval', () => {
      const algo = tokenBucket({ capacity: 100, refillRate: 10, refillInterval: '1s' })
      let state: any = null

      // Consume all
      for (let i = 0; i < 100; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // After 5 seconds: 50 tokens refilled
      const info = algo.peek?.(state, now + 5000)
      expect(info.remaining).toBe(50)
    })
  })

  describe('cost support', () => {
    it('consumes multiple tokens', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      const r1 = algo.check(state, now, 5)
      expect(r1.allowed).toBe(true)
      expect(r1.info.remaining).toBe(5)
      state = r1.state

      const r2 = algo.check(state, now, 5)
      expect(r2.allowed).toBe(true)
      expect(r2.info.remaining).toBe(0)
      state = r2.state

      const r3 = algo.check(state, now, 1)
      expect(r3.allowed).toBe(false)
    })

    it('denies if cost exceeds available tokens', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      const r1 = algo.check(state, now, 8)
      state = r1.state

      const r2 = algo.check(state, now, 5)
      expect(r2.allowed).toBe(false)
    })
  })

  describe('retryAfter', () => {
    it('returns time until enough tokens available', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      // Consume all
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now, 1)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBe(1000) // 1 token in 1 second
    })

    it('retryAfter scales with cost', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now, 5)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBe(5000) // 5 tokens = 5 seconds
    })
  })

  describe('peek', () => {
    it('returns current info without consuming', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      const info = algo.peek?.(state, now)
      expect(info.remaining).toBe(9)

      // Peek again - unchanged
      const info2 = algo.peek?.(state, now)
      expect(info2.remaining).toBe(9)
    })

    it('accounts for refill in peek', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      let state: any = null

      // Use 5 tokens
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // Peek 3 seconds later: should show 5 + 3 = 8
      const info = algo.peek?.(state, now + 3000)
      expect(info.remaining).toBe(8)
    })

    it('returns full capacity for null state', () => {
      const algo = tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' })
      const info = algo.peek?.(null, now)
      expect(info.remaining).toBe(10)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { gcra } from '../../src/algorithms/gcra.js'

describe('gcra', () => {
  const now = 1000000

  describe('basic behavior', () => {
    it('allows requests within limit', () => {
      const algo = gcra({ limit: 5, period: '1m' })
      let state = algo.initialState()

      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })

    it('denies requests over burst', () => {
      const algo = gcra({ limit: 5, period: '1m' })
      let state: any = null

      // Burst through all 5
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }

      // 6th should be denied
      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)
    })

    it('remaining decreases with each request', () => {
      const algo = gcra({ limit: 10, period: '1m' })
      let state: any = null

      const r1 = algo.check(state, now)
      expect(r1.info.remaining).toBe(9)
      state = r1.state

      const r2 = algo.check(state, now)
      expect(r2.info.remaining).toBe(8)
    })
  })

  describe('time-based recovery', () => {
    it('recovers tokens over time', () => {
      const algo = gcra({ limit: 10, period: '10s' })
      // emission_interval = 10000 / 10 = 1000ms per token
      let state: any = null

      // Use all 10 tokens
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // Denied immediately
      expect(algo.check(state, now).allowed).toBe(false)

      // After 1 second (1 emission interval), 1 token available
      const r = algo.check(state, now + 1000)
      expect(r.allowed).toBe(true)
    })

    it('fully recovers after period', () => {
      const algo = gcra({ limit: 5, period: '10s' })
      let state: any = null

      // Use all
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // After full period, should have full burst available
      const info = algo.peek?.(state, now + 10000)
      expect(info.remaining).toBe(5)
    })
  })

  describe('burst configuration', () => {
    it('allows custom burst size', () => {
      const algo = gcra({ limit: 10, period: '1m', burst: 3 })
      let state: any = null

      // Can only burst 3
      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }

      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)
    })

    it('burst defaults to limit', () => {
      const algo = gcra({ limit: 5, period: '1m' })
      let state: any = null

      // Can burst up to limit
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })
  })

  describe('cost support', () => {
    it('consumes multiple units', () => {
      const algo = gcra({ limit: 10, period: '10s' })
      let state: any = null

      const r1 = algo.check(state, now, 5)
      expect(r1.allowed).toBe(true)
      state = r1.state

      const r2 = algo.check(state, now, 5)
      expect(r2.allowed).toBe(true)
      state = r2.state

      const r3 = algo.check(state, now, 1)
      expect(r3.allowed).toBe(false)
    })

    it('denies if cost exceeds remaining burst', () => {
      const algo = gcra({ limit: 10, period: '10s' })
      let state: any = null

      const r1 = algo.check(state, now, 8)
      state = r1.state

      const r2 = algo.check(state, now, 5)
      expect(r2.allowed).toBe(false)
    })
  })

  describe('retryAfter', () => {
    it('returns time until next request is allowed', () => {
      const algo = gcra({ limit: 10, period: '10s' })
      // emission_interval = 1000ms
      let state: any = null

      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBeGreaterThan(0)
      expect(denied.info.retryAfter).toBeLessThanOrEqual(1000)
    })
  })

  describe('null state', () => {
    it('treats null state as fresh', () => {
      const algo = gcra({ limit: 5, period: '1m' })
      const result = algo.check(null, now)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(4)
    })
  })

  describe('peek', () => {
    it('returns info without modifying state', () => {
      const algo = gcra({ limit: 10, period: '10s' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      const info = algo.peek?.(state, now)
      expect(info.remaining).toBe(9)

      const info2 = algo.peek?.(state, now)
      expect(info2.remaining).toBe(9)
    })

    it('returns full burst for null state', () => {
      const algo = gcra({ limit: 10, period: '10s' })
      const info = algo.peek?.(null, now)
      expect(info.remaining).toBe(10)
    })

    it('shows recovery over time', () => {
      const algo = gcra({ limit: 10, period: '10s' })
      // emission_interval = 1000ms
      let state: any = null

      // Use all 10
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // Peek at now: 0 remaining
      const info0 = algo.peek?.(state, now)
      expect(info0.remaining).toBe(0)

      // Peek 5 seconds later: should have ~5 recovered
      const info5 = algo.peek?.(state, now + 5000)
      expect(info5.remaining).toBe(5)
    })
  })
})

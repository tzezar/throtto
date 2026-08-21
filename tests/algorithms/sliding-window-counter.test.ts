import { describe, expect, it } from 'vitest'
import { slidingWindowCounter } from '../../src/algorithms/sliding-window-counter.js'

describe('slidingWindowCounter', () => {
  const now = 1000000
  const windowMs = 60000

  describe('basic behavior', () => {
    it('allows requests within limit', () => {
      const algo = slidingWindowCounter({ limit: 5, window: '1m' })
      let state = algo.initialState()

      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })

    it('denies requests over limit', () => {
      const algo = slidingWindowCounter({ limit: 3, window: '1m' })
      let state = algo.initialState()

      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }

      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)
    })

    it('returns correct remaining count', () => {
      const algo = slidingWindowCounter({ limit: 10, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now)
      expect(r1.info.remaining).toBe(9)
      state = r1.state

      const r2 = algo.check(state, now)
      expect(r2.info.remaining).toBe(8)
    })
  })

  describe('sliding window approximation', () => {
    it('considers previous window count with overlap ratio', () => {
      const algo = slidingWindowCounter({ limit: 10, window: '1m' })

      // Fill previous window with 10 requests
      const state: any = { currentCount: 0, previousCount: 10, windowStart: now }

      // 30 seconds into current window = 50% overlap with previous
      // effective = 10 * 0.5 + 0 = 5, so 5 remaining
      const halfWay = now + 30000
      const advanced = algo.check(state, halfWay)
      expect(advanced.info.remaining).toBe(4) // 10 - (5 + 1) = 4
      expect(advanced.allowed).toBe(true)
    })

    it('overlap decreases over time', () => {
      const algo = slidingWindowCounter({ limit: 10, window: '1m' })

      // 10 requests in previous window
      const state = { currentCount: 0, previousCount: 10, windowStart: now }

      // At 75% through current window, overlap = 25%
      // effective = 10 * 0.25 + 0 = 2.5
      const t = now + 45000
      const info = algo.peek?.(state, t)
      expect(info.remaining).toBe(7) // floor(10 - 2.5) = 7
    })

    it('smoothly transitions across window boundaries', () => {
      const algo = slidingWindowCounter({ limit: 10, window: '1m' })
      let state: any = null

      // Fill up at the end of a window
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now + i)
        state = result.state
      }

      // Right at window boundary - previous window full
      const atBoundary = now + windowMs
      const info = algo.peek?.(state, atBoundary)
      // Previous count = 10, overlap = (60000 - 0) / 60000 = 1.0 (just entered new window)
      // effective = 10 * 1.0 + 0 = 10 -> remaining = 0
      expect(info.remaining).toBe(0)

      // Half into new window
      const halfWay = now + windowMs + 30000
      const info2 = algo.peek?.(state, halfWay)
      // overlap = (60000 - 30000) / 60000 = 0.5
      // effective = 10 * 0.5 + 0 = 5 -> remaining = 5
      expect(info2.remaining).toBe(5)
    })
  })

  describe('window expiry', () => {
    it('fully resets after 2 windows pass', () => {
      const algo = slidingWindowCounter({ limit: 5, window: '1m' })
      let state: any = null

      // Fill limit
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // After 2 full windows, both previous and current are stale
      const farFuture = now + windowMs * 2 + 1
      const result = algo.check(state, farFuture)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(4)
    })
  })

  describe('cost support', () => {
    it('supports variable cost', () => {
      const algo = slidingWindowCounter({ limit: 10, window: '1m' })
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

    it('denies if cost exceeds remaining', () => {
      const algo = slidingWindowCounter({ limit: 10, window: '1m' })
      let state: any = null

      const r1 = algo.check(state, now, 8)
      state = r1.state

      const r2 = algo.check(state, now, 5)
      expect(r2.allowed).toBe(false)
    })
  })

  describe('null state', () => {
    it('treats null state as fresh window', () => {
      const algo = slidingWindowCounter({ limit: 5, window: '1m' })
      const result = algo.check(null, now)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(4)
    })
  })

  describe('peek', () => {
    it('returns info without modifying state', () => {
      const algo = slidingWindowCounter({ limit: 5, window: '1m' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      const info1 = algo.peek?.(state, now)
      const info2 = algo.peek?.(state, now)
      expect(info1.remaining).toBe(info2.remaining)
    })

    it('returns full limit for null state', () => {
      const algo = slidingWindowCounter({ limit: 10, window: '1m' })
      const info = algo.peek?.(null, now)
      expect(info.remaining).toBe(10)
    })
  })

  describe('retryAfter', () => {
    it('returns retryAfter when denied', () => {
      const algo = slidingWindowCounter({ limit: 1, window: '1m' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      const denied = algo.check(state, now + 10000)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBeGreaterThan(0)
    })
  })
})

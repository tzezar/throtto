import { describe, expect, it } from 'vitest'
import { slidingWindowLog } from '../../src/algorithms/sliding-window-log.js'

describe('slidingWindowLog', () => {
  const now = 1000000
  const windowMs = 60000

  describe('basic behavior', () => {
    it('allows requests within limit', () => {
      const algo = slidingWindowLog({ limit: 5, window: '1m' })
      let state = algo.initialState()

      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now + i)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })

    it('denies requests over limit', () => {
      const algo = slidingWindowLog({ limit: 3, window: '1m' })
      let state = algo.initialState()

      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now + i)
        state = result.state
      }

      const denied = algo.check(state, now + 3)
      expect(denied.allowed).toBe(false)
    })

    it('returns correct remaining count', () => {
      const algo = slidingWindowLog({ limit: 5, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now)
      expect(r1.info.remaining).toBe(4)
      state = r1.state

      const r2 = algo.check(state, now + 1)
      expect(r2.info.remaining).toBe(3)
    })
  })

  describe('sliding window behavior', () => {
    it('allows requests after old ones expire', () => {
      const algo = slidingWindowLog({ limit: 3, window: '1m' })
      let state = algo.initialState()

      // Fill limit at t=0, t=1, t=2
      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now + i)
        state = result.state
      }

      // Denied at t=30s
      const denied = algo.check(state, now + 30000)
      expect(denied.allowed).toBe(false)

      // After first request expires (t > now + 60000)
      const allowed = algo.check(state, now + windowMs + 1)
      expect(allowed.allowed).toBe(true)
    })

    it('expires entries one by one', () => {
      const algo = slidingWindowLog({ limit: 3, window: '1m' })
      let state = algo.initialState()

      // Requests at t=0, t=10s, t=20s
      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now + 10000)
      state = r2.state
      const r3 = algo.check(state, now + 20000)
      state = r3.state

      // After first expires (t=60001), one slot free
      const a1 = algo.check(state, now + windowMs + 1)
      expect(a1.allowed).toBe(true)
      state = a1.state

      // Full again
      const d1 = algo.check(state, now + windowMs + 2)
      expect(d1.allowed).toBe(false)

      // After second expires (t=70001)
      const a2 = algo.check(state, now + windowMs + 10001)
      expect(a2.allowed).toBe(true)
    })

    it('is more precise than fixed window (no boundary spike)', () => {
      const algo = slidingWindowLog({ limit: 10, window: '1m' })
      let state = algo.initialState()

      // 10 requests at t=59s (end of a "minute")
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now + 59000 + i)
        state = result.state
      }

      // At t=61s, those requests are still within the 60s sliding window
      const denied = algo.check(state, now + 61000)
      expect(denied.allowed).toBe(false)

      // At t=119s (> 59s + 60s), they've expired
      const allowed = algo.check(state, now + 119001)
      expect(allowed.allowed).toBe(true)
    })
  })

  describe('cost support', () => {
    it('adds multiple timestamps for cost > 1', () => {
      const algo = slidingWindowLog({ limit: 10, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now, 5)
      expect(r1.allowed).toBe(true)
      expect(r1.info.remaining).toBe(5)
      state = r1.state

      const r2 = algo.check(state, now + 1, 5)
      expect(r2.allowed).toBe(true)
      expect(r2.info.remaining).toBe(0)
      state = r2.state

      const r3 = algo.check(state, now + 2, 1)
      expect(r3.allowed).toBe(false)
    })

    it('denies if cost exceeds remaining', () => {
      const algo = slidingWindowLog({ limit: 10, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now, 8)
      state = r1.state

      const r2 = algo.check(state, now + 1, 5)
      expect(r2.allowed).toBe(false)
    })
  })

  describe('retryAfter', () => {
    it('returns time until oldest entry expires', () => {
      const algo = slidingWindowLog({ limit: 2, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now + 10000)
      state = r2.state

      const denied = algo.check(state, now + 30000)
      expect(denied.allowed).toBe(false)
      // Oldest (now) expires at now + 60000, we're at now + 30000
      expect(denied.info.retryAfter).toBe(30000)
    })
  })

  describe('null state', () => {
    it('treats null state as empty log', () => {
      const algo = slidingWindowLog({ limit: 5, window: '1m' })
      const result = algo.check(null, now)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(4)
    })
  })

  describe('peek', () => {
    it('returns info without modifying state', () => {
      const algo = slidingWindowLog({ limit: 5, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now)
      state = r1.state

      const info = algo.peek?.(state, now)
      expect(info.remaining).toBe(4)

      const info2 = algo.peek?.(state, now)
      expect(info2.remaining).toBe(4)
    })

    it('returns full limit for null state', () => {
      const algo = slidingWindowLog({ limit: 10, window: '1m' })
      const info = algo.peek?.(null, now)
      expect(info.remaining).toBe(10)
    })

    it('reflects expired entries', () => {
      const algo = slidingWindowLog({ limit: 3, window: '1m' })
      let state = algo.initialState()

      for (let i = 0; i < 3; i++) {
        const r = algo.check(state, now + i)
        state = r.state
      }

      // All entries expired
      const info = algo.peek?.(state, now + windowMs + 10)
      expect(info.remaining).toBe(3)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'

describe('fixedWindow', () => {
  const now = 1000000

  describe('basic behavior', () => {
    it('allows requests within limit', () => {
      const algo = fixedWindow({ limit: 5, window: '1m' })
      let state = algo.initialState()

      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })

    it('denies requests over limit', () => {
      const algo = fixedWindow({ limit: 3, window: '1m' })
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
      const algo = fixedWindow({ limit: 5, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now)
      expect(r1.info.remaining).toBe(4)
      state = r1.state

      const r2 = algo.check(state, now)
      expect(r2.info.remaining).toBe(3)
      state = r2.state
    })

    it('resets after window expires', () => {
      const algo = fixedWindow({ limit: 3, window: '1m' })
      let state = algo.initialState()

      // Fill up the limit
      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)

      // After window expires
      const afterWindow = now + 60001
      const allowed = algo.check(state, afterWindow)
      expect(allowed.allowed).toBe(true)
      expect(allowed.info.remaining).toBe(2)
    })

    it('returns retryAfter when denied', () => {
      const algo = fixedWindow({ limit: 1, window: '30s' })
      let state = algo.initialState()

      const r1 = algo.check(state, now)
      state = r1.state

      const denied = algo.check(state, now + 5000)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBe(25000)
    })
  })

  describe('cost support', () => {
    it('consumes multiple tokens with cost', () => {
      const algo = fixedWindow({ limit: 10, window: '1m' })
      let state = algo.initialState()

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
      const algo = fixedWindow({ limit: 10, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now, 8)
      state = r1.state

      const r2 = algo.check(state, now, 5)
      expect(r2.allowed).toBe(false)
    })
  })

  describe('window alignment', () => {
    it('aligns to clock boundaries with floor', () => {
      const windowMs = 60000
      const algo = fixedWindow({ limit: 5, window: '1m', alignment: 'floor' })

      // Now is 45 seconds into a minute
      const alignedNow = windowMs * 100 + 45000
      const result = algo.check(null, alignedNow)

      // Window should start at floor boundary
      expect(result.state.windowStart).toBe(windowMs * 100)
      expect(result.info.resetAt).toBe(windowMs * 101)
    })

    it('window resets at aligned boundary', () => {
      const windowMs = 60000
      const algo = fixedWindow({ limit: 1, window: '1m', alignment: 'floor' })

      const t1 = windowMs * 10 + 30000 // 30s into window
      const r1 = algo.check(null, t1)
      expect(r1.allowed).toBe(true)

      // Still in same aligned window
      const t2 = windowMs * 10 + 50000 // 50s into same window
      const r2 = algo.check(r1.state, t2)
      expect(r2.allowed).toBe(false)

      // Next aligned window
      const t3 = windowMs * 11 + 5000 // 5s into next window
      const r3 = algo.check(r2.state, t3)
      expect(r3.allowed).toBe(true)
    })
  })

  describe('null state', () => {
    it('treats null state as fresh', () => {
      const algo = fixedWindow({ limit: 5, window: '1m' })
      const result = algo.check(null, now)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(4)
    })
  })

  describe('peek', () => {
    it('returns current info without modifying state', () => {
      const algo = fixedWindow({ limit: 5, window: '1m' })
      let state = algo.initialState()

      const r1 = algo.check(state, now)
      state = r1.state

      const info = algo.peek?.(state, now)
      expect(info.limit).toBe(5)
      expect(info.remaining).toBe(4)

      // Peek again - should be the same
      const info2 = algo.peek?.(state, now)
      expect(info2.remaining).toBe(4)
    })

    it('reports full limit for null state', () => {
      const algo = fixedWindow({ limit: 10, window: '1m' })
      const info = algo.peek?.(null, now)
      expect(info.remaining).toBe(10)
    })

    it('reports full limit after window expires', () => {
      const algo = fixedWindow({ limit: 3, window: '1m' })
      let state = algo.initialState()

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        const r = algo.check(state, now)
        state = r.state
      }

      const info = algo.peek?.(state, now + 61000)
      expect(info.remaining).toBe(3)
    })
  })

  describe('ttlMs', () => {
    it('returns time until window reset', () => {
      const algo = fixedWindow({ limit: 5, window: '1m' })
      const result = algo.check(null, now)
      expect(result.ttlMs).toBeLessThanOrEqual(60000)
      expect(result.ttlMs).toBeGreaterThan(0)
    })
  })
})

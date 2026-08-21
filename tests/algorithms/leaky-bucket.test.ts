import { describe, expect, it } from 'vitest'
import { leakyBucket } from '../../src/algorithms/leaky-bucket.js'

describe('leakyBucket', () => {
  const now = 1000000

  describe('basic behavior', () => {
    it('allows requests while bucket has space', () => {
      const algo = leakyBucket({ capacity: 5, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })

    it('denies when bucket is full', () => {
      const algo = leakyBucket({ capacity: 3, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)
    })

    it('remaining decreases as bucket fills', () => {
      const algo = leakyBucket({ capacity: 5, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      const r1 = algo.check(state, now)
      expect(r1.info.remaining).toBe(4)
      state = r1.state

      const r2 = algo.check(state, now)
      expect(r2.info.remaining).toBe(3)
    })

    it('starts with empty bucket (full capacity available)', () => {
      const algo = leakyBucket({ capacity: 10, leakRate: 1, leakInterval: '1s' })
      const info = algo.peek?.(null, now)
      expect(info.remaining).toBe(10)
    })
  })

  describe('leak/drain', () => {
    it('drains over time creating space', () => {
      const algo = leakyBucket({ capacity: 5, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      // Fill bucket
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // Full - denied
      expect(algo.check(state, now).allowed).toBe(false)

      // After 2 seconds: 2 items leaked, space for 2
      const result = algo.check(state, now + 2000)
      expect(result.allowed).toBe(true)
      // Queue was 5, leaked 2, now add 1 = 4 remaining = 5 - 4 = 1
      expect(result.info.remaining).toBe(1)
    })

    it('does not drain below zero', () => {
      const algo = leakyBucket({ capacity: 10, leakRate: 5, leakInterval: '1s' })
      let state: any = null

      // Add 2 items
      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now)
      state = r2.state

      // After long time, queue should be 0
      const info = algo.peek?.(state, now + 100000)
      expect(info.remaining).toBe(10)
    })

    it('supports higher leak rates', () => {
      const algo = leakyBucket({ capacity: 100, leakRate: 10, leakInterval: '1s' })
      let state: any = null

      // Fill to 50
      for (let i = 0; i < 50; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // After 3 seconds: 30 leaked, queue = 20, remaining = 80
      const info = algo.peek?.(state, now + 3000)
      expect(info.remaining).toBe(80)
    })

    it('leaks with custom interval', () => {
      const algo = leakyBucket({ capacity: 10, leakRate: 1, leakInterval: '500ms' })
      let state: any = null

      // Fill to 10
      for (let i = 0; i < 10; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // After 1 second (2 leak intervals): 2 items leaked
      const info = algo.peek?.(state, now + 1000)
      expect(info.remaining).toBe(2)
    })
  })

  describe('cost support', () => {
    it('adds multiple items with cost', () => {
      const algo = leakyBucket({ capacity: 10, leakRate: 1, leakInterval: '1s' })
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

    it('denies if cost would overflow bucket', () => {
      const algo = leakyBucket({ capacity: 10, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      const r1 = algo.check(state, now, 8)
      state = r1.state

      const r2 = algo.check(state, now, 5)
      expect(r2.allowed).toBe(false)
    })
  })

  describe('retryAfter', () => {
    it('returns time until enough space is available', () => {
      const algo = leakyBucket({ capacity: 5, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      // Fill bucket
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now, 1)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBe(1000) // need 1 leak = 1 interval
    })

    it('retryAfter scales with cost', () => {
      const algo = leakyBucket({ capacity: 5, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      // Fill bucket
      for (let i = 0; i < 5; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      const denied = algo.check(state, now, 3)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBe(3000) // need 3 leaks
    })
  })

  describe('peek', () => {
    it('returns current state without modifying', () => {
      const algo = leakyBucket({ capacity: 10, leakRate: 1, leakInterval: '1s' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      const info = algo.peek?.(state, now)
      expect(info.remaining).toBe(9)

      // Peek again - same
      const info2 = algo.peek?.(state, now)
      expect(info2.remaining).toBe(9)
    })

    it('accounts for leak in peek', () => {
      const algo = leakyBucket({ capacity: 10, leakRate: 2, leakInterval: '1s' })
      let state: any = null

      // Fill to 8
      for (let i = 0; i < 8; i++) {
        const result = algo.check(state, now)
        state = result.state
      }

      // Peek 2 seconds later: 4 leaked, queue = 4, remaining = 6
      const info = algo.peek?.(state, now + 2000)
      expect(info.remaining).toBe(6)
    })
  })
})

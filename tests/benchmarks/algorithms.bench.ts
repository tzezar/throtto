import { bench, describe } from 'vitest'
import {
  concurrency,
  fixedWindow,
  gcra,
  leakyBucket,
  slidingWindowCounter,
  slidingWindowLog,
  tokenBucket,
} from '../../src/algorithms/index.js'

const now = 1_700_000_000_000

describe('Algorithms', () => {
  // ─── Fixed Window ────────────────────────────────────────────────────────────

  describe('fixedWindow', () => {
    const algo = fixedWindow({ limit: 1000, window: 60_000 })

    bench('check - null state (first request)', () => {
      algo.check(null, now)
    })

    bench('check - initial state', () => {
      const state = algo.initialState()
      algo.check(state, now)
    })

    bench('check - mid-use (500/1000)', () => {
      algo.check({ count: 500, windowStart: now - 30_000 }, now)
    })

    bench('check - near limit (999/1000)', () => {
      algo.check({ count: 999, windowStart: now - 30_000 }, now)
    })

    bench('check - at limit (denied)', () => {
      algo.check({ count: 1000, windowStart: now - 30_000 }, now)
    })

    bench('check - expired window (reset)', () => {
      algo.check({ count: 800, windowStart: now - 120_000 }, now)
    })
  })

  // ─── Sliding Window Counter ──────────────────────────────────────────────────

  describe('slidingWindowCounter', () => {
    const algo = slidingWindowCounter({ limit: 1000, window: 60_000 })

    bench('check - null state', () => {
      algo.check(null, now)
    })

    bench('check - mid-use', () => {
      algo.check({ currentCount: 300, previousCount: 200, windowStart: now - 30_000 }, now)
    })

    bench('check - near limit', () => {
      algo.check({ currentCount: 700, previousCount: 500, windowStart: now - 10_000 }, now)
    })

    bench('check - window rotation', () => {
      algo.check({ currentCount: 400, previousCount: 300, windowStart: now - 70_000 }, now)
    })

    bench('check - double window expiry', () => {
      algo.check({ currentCount: 400, previousCount: 300, windowStart: now - 130_000 }, now)
    })
  })

  // ─── Sliding Window Log ──────────────────────────────────────────────────────

  describe('slidingWindowLog', () => {
    const algo = slidingWindowLog({ limit: 1000, window: 60_000 })

    bench('check - null state', () => {
      algo.check(null, now)
    })

    bench('check - small log (10 entries)', () => {
      const timestamps = Array.from({ length: 10 }, (_, i) => now - i * 1000)
      algo.check({ timestamps }, now)
    })

    bench('check - medium log (100 entries)', () => {
      const timestamps = Array.from({ length: 100 }, (_, i) => now - i * 500)
      algo.check({ timestamps }, now)
    })

    bench('check - large log (500 entries)', () => {
      const timestamps = Array.from({ length: 500 }, (_, i) => now - i * 100)
      algo.check({ timestamps }, now)
    })

    bench('check - log with expired entries to prune', () => {
      const timestamps = [
        // 50 expired timestamps
        ...Array.from({ length: 50 }, (_, i) => now - 120_000 - i * 1000),
        // 50 valid timestamps
        ...Array.from({ length: 50 }, (_, i) => now - i * 500),
      ]
      algo.check({ timestamps }, now)
    })
  })

  // ─── Token Bucket ────────────────────────────────────────────────────────────

  describe('tokenBucket', () => {
    const algo = tokenBucket({ capacity: 1000, refillRate: 10, refillInterval: 1_000 })

    bench('check - null state (full bucket)', () => {
      algo.check(null, now)
    })

    bench('check - half full', () => {
      algo.check({ tokens: 500, lastRefill: now }, now)
    })

    bench('check - near empty (10 tokens)', () => {
      algo.check({ tokens: 10, lastRefill: now }, now)
    })

    bench('check - empty (denied)', () => {
      algo.check({ tokens: 0, lastRefill: now }, now)
    })

    bench('check - refill calculation', () => {
      algo.check({ tokens: 100, lastRefill: now - 5_000 }, now)
    })

    bench('check - large refill gap', () => {
      algo.check({ tokens: 0, lastRefill: now - 60_000 }, now)
    })
  })

  // ─── Leaky Bucket ────────────────────────────────────────────────────────────

  describe('leakyBucket', () => {
    const algo = leakyBucket({ capacity: 1000, leakRate: 10, leakInterval: 1_000 })

    bench('check - null state (empty queue)', () => {
      algo.check(null, now)
    })

    bench('check - half full queue', () => {
      algo.check({ queueSize: 500, lastLeak: now }, now)
    })

    bench('check - near capacity', () => {
      algo.check({ queueSize: 990, lastLeak: now }, now)
    })

    bench('check - full (denied)', () => {
      algo.check({ queueSize: 1000, lastLeak: now }, now)
    })

    bench('check - leak calculation', () => {
      algo.check({ queueSize: 800, lastLeak: now - 5_000 }, now)
    })

    bench('check - large leak gap', () => {
      algo.check({ queueSize: 500, lastLeak: now - 60_000 }, now)
    })
  })

  // ─── GCRA ────────────────────────────────────────────────────────────────────

  describe('gcra', () => {
    const algo = gcra({ limit: 1000, period: 60_000 })

    bench('check - null state', () => {
      algo.check(null, now)
    })

    bench('check - recent TAT (plenty of budget)', () => {
      algo.check({ tat: now + 1_000 }, now)
    })

    bench('check - TAT near tolerance (tight budget)', () => {
      algo.check({ tat: now + 55_000 }, now)
    })

    bench('check - TAT exceeded (denied)', () => {
      algo.check({ tat: now + 120_000 }, now)
    })

    bench('check - TAT in the past (fully reset)', () => {
      algo.check({ tat: now - 30_000 }, now)
    })
  })

  // ─── Concurrency ─────────────────────────────────────────────────────────────

  describe('concurrency', () => {
    const algo = concurrency({ maxConcurrent: 100 })

    bench('check - null state', () => {
      algo.check(null, now)
    })

    bench('check - few active tickets (10)', () => {
      const tickets = Array.from({ length: 10 }, (_, i) => ({
        id: `ticket-${i}`,
        expiresAt: now + 30_000,
      }))
      algo.check({ tickets }, now)
    })

    bench('check - many active tickets (90)', () => {
      const tickets = Array.from({ length: 90 }, (_, i) => ({
        id: `ticket-${i}`,
        expiresAt: now + 30_000,
      }))
      algo.check({ tickets }, now)
    })

    bench('check - at capacity (denied)', () => {
      const tickets = Array.from({ length: 100 }, (_, i) => ({
        id: `ticket-${i}`,
        expiresAt: now + 30_000,
      }))
      algo.check({ tickets }, now)
    })

    bench('check - tickets with expired entries to prune', () => {
      const tickets = [
        // 30 expired tickets
        ...Array.from({ length: 30 }, (_, i) => ({
          id: `expired-${i}`,
          expiresAt: now - 1_000,
        })),
        // 50 active tickets
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `active-${i}`,
          expiresAt: now + 30_000,
        })),
      ]
      algo.check({ tickets }, now)
    })
  })

  // ─── Cross-algorithm comparison ──────────────────────────────────────────────

  describe('comparison - null state check', () => {
    const fw = fixedWindow({ limit: 1000, window: 60_000 })
    const swc = slidingWindowCounter({ limit: 1000, window: 60_000 })
    const swl = slidingWindowLog({ limit: 1000, window: 60_000 })
    const tb = tokenBucket({ capacity: 1000, refillRate: 10, refillInterval: 1_000 })
    const lb = leakyBucket({ capacity: 1000, leakRate: 10, leakInterval: 1_000 })
    const g = gcra({ limit: 1000, period: 60_000 })
    const c = concurrency({ maxConcurrent: 100 })

    bench('fixedWindow', () => {
      fw.check(null, now)
    })
    bench('slidingWindowCounter', () => {
      swc.check(null, now)
    })
    bench('slidingWindowLog', () => {
      swl.check(null, now)
    })
    bench('tokenBucket', () => {
      tb.check(null, now)
    })
    bench('leakyBucket', () => {
      lb.check(null, now)
    })
    bench('gcra', () => {
      g.check(null, now)
    })
    bench('concurrency', () => {
      c.check(null, now)
    })
  })

  describe('comparison - mid-use check', () => {
    const fw = fixedWindow({ limit: 1000, window: 60_000 })
    const swc = slidingWindowCounter({ limit: 1000, window: 60_000 })
    const swl = slidingWindowLog({ limit: 1000, window: 60_000 })
    const tb = tokenBucket({ capacity: 1000, refillRate: 10, refillInterval: 1_000 })
    const lb = leakyBucket({ capacity: 1000, leakRate: 10, leakInterval: 1_000 })
    const g = gcra({ limit: 1000, period: 60_000 })
    const c = concurrency({ maxConcurrent: 100 })

    const fwState = { count: 500, windowStart: now - 30_000 }
    const swcState = { currentCount: 300, previousCount: 200, windowStart: now - 30_000 }
    const swlState = { timestamps: Array.from({ length: 500 }, (_, i) => now - i * 100) }
    const tbState = { tokens: 500, lastRefill: now - 5_000 }
    const lbState = { queueSize: 500, lastLeak: now - 5_000 }
    const gState = { tat: now + 10_000 }
    const cState = {
      tickets: Array.from({ length: 50 }, (_, i) => ({
        id: `t-${i}`,
        expiresAt: now + 30_000,
      })),
    }

    bench('fixedWindow', () => {
      fw.check(fwState, now)
    })
    bench('slidingWindowCounter', () => {
      swc.check(swcState, now)
    })
    bench('slidingWindowLog', () => {
      swl.check(swlState, now)
    })
    bench('tokenBucket', () => {
      tb.check(tbState, now)
    })
    bench('leakyBucket', () => {
      lb.check(lbState, now)
    })
    bench('gcra', () => {
      g.check(gState, now)
    })
    bench('concurrency', () => {
      c.check(cState, now)
    })
  })
})

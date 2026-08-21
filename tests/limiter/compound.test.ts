import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { gcra } from '../../src/algorithms/gcra.js'
import { leakyBucket } from '../../src/algorithms/leaky-bucket.js'
import { slidingWindowCounter } from '../../src/algorithms/sliding-window-counter.js'
import { tokenBucket } from '../../src/algorithms/token-bucket.js'
import { createCompoundLimiter } from '../../src/limiter/compound.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createCompoundLimiter', () => {
  it('allows when all layers allow', async () => {
    const limiter = createCompoundLimiter([
      {
        name: 'per-second',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 10, window: '1s' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'per-minute',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 100, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
    ])

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('denies when any layer denies', async () => {
    const limiter = createCompoundLimiter([
      {
        name: 'strict',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 1, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'loose',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 100, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
    ])

    await limiter.check('user:1')
    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('returns most restrictive result when all allow', async () => {
    const limiter = createCompoundLimiter([
      {
        name: 'strict',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 5, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'loose',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 100, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
    ])

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4) // from the strict layer
    await limiter.shutdown()
  })

  it('resets all layers', async () => {
    const limiter = createCompoundLimiter([
      {
        name: 'a',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 1, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'b',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 1, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
    ])

    await limiter.check('user:1')
    await limiter.reset('user:1')

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('peek returns most restrictive info', async () => {
    const limiter = createCompoundLimiter([
      {
        name: 'strict',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 3, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'loose',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 100, window: '1m' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
    ])

    await limiter.check('user:1')
    const info = await limiter.peek('user:1')
    expect(info).not.toBeNull()
    expect(info?.remaining).toBe(2)
    await limiter.shutdown()
  })

  it('works with mixed algorithms (token-bucket + sliding-window + fixed-window)', async () => {
    const limiter = createCompoundLimiter([
      {
        name: 'burst',
        limiter: createLimiter({
          algorithm: tokenBucket({ capacity: 5, refillRate: 1, refillInterval: '1s' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'sustained',
        limiter: createLimiter({
          algorithm: slidingWindowCounter({ limit: 10, window: 60_000 }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'hourly',
        limiter: createLimiter({
          algorithm: fixedWindow({ limit: 100, window: '1h' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
    ])

    // First 5 requests pass all layers (token bucket capacity = 5)
    for (let i = 0; i < 5; i++) {
      const r = await limiter.check('user:1')
      expect(r.allowed).toBe(true)
    }

    // 6th request denied by token bucket (burst layer), even though sustained/hourly still have room
    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('works with gcra + leaky-bucket mix', async () => {
    const limiter = createCompoundLimiter([
      {
        name: 'gcra',
        limiter: createLimiter({
          algorithm: gcra({ limit: 3, period: 60_000 }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
      {
        name: 'leaky',
        limiter: createLimiter({
          algorithm: leakyBucket({ capacity: 10, leakRate: 1, leakInterval: '1s' }),
          store: memoryStore({ cleanupInterval: 0 }),
        }),
      },
    ])

    // GCRA limit is 3, leaky bucket capacity is 10 - GCRA should be the bottleneck
    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(true)
    const r2 = await limiter.check('user:1')
    expect(r2.allowed).toBe(true)
    const r3 = await limiter.check('user:1')
    expect(r3.allowed).toBe(true)

    // 4th denied by GCRA
    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })
})

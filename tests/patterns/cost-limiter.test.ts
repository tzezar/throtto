import { describe, expect, it } from 'vitest'
import { tokenBucket } from '../../src/algorithms/token-bucket.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { withCostMapping } from '../../src/patterns/cost-limiter.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withCostMapping', () => {
  it('applies cost based on context', async () => {
    const limiter = withCostMapping(
      createLimiter({
        algorithm: tokenBucket({ capacity: 100, refillRate: 10, refillInterval: '1s' }),
        store: memoryStore({ cleanupInterval: 0 }),
      }),
      {
        resolveCost: (ctx: string) => {
          if (ctx.includes('heavy')) return 10
          return 1
        },
      },
    )

    const r1 = await limiter.check('light-op')
    expect(r1.cost).toBe(1)

    const r2 = await limiter.check('heavy-op')
    expect(r2.cost).toBe(10)
    await limiter.shutdown()
  })

  it('explicit cost overrides mapping', async () => {
    const limiter = withCostMapping(
      createLimiter({
        algorithm: tokenBucket({ capacity: 100, refillRate: 10, refillInterval: '1s' }),
        store: memoryStore({ cleanupInterval: 0 }),
      }),
      { resolveCost: () => 5 },
    )

    const result = await limiter.check('user:1', { cost: 1 })
    expect(result.cost).toBe(1) // explicit override
    await limiter.shutdown()
  })

  it('consumes correct amount from capacity', async () => {
    const limiter = withCostMapping(
      createLimiter({
        algorithm: tokenBucket({ capacity: 10, refillRate: 1, refillInterval: '1s' }),
        store: memoryStore({ cleanupInterval: 0 }),
      }),
      { resolveCost: () => 5 },
    )

    const r1 = await limiter.check('user:1')
    expect(r1.remaining).toBe(5)

    const r2 = await limiter.check('user:1')
    expect(r2.remaining).toBe(0)

    const r3 = await limiter.check('user:1')
    expect(r3.allowed).toBe(false)
    await limiter.shutdown()
  })
})

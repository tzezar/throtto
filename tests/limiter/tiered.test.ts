import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createTieredLimiter } from '../../src/limiter/tiered.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createTieredLimiter', () => {
  function createTiered() {
    return createTieredLimiter({
      tiers: [
        { name: 'free', algorithm: fixedWindow({ limit: 10, window: '1m' }) },
        { name: 'pro', algorithm: fixedWindow({ limit: 100, window: '1m' }) },
        { name: 'enterprise', algorithm: fixedWindow({ limit: 1000, window: '1m' }) },
      ],
      resolveTier: (ctx: string) => {
        if (ctx.startsWith('ent:')) return 'enterprise'
        if (ctx.startsWith('pro:')) return 'pro'
        return 'free'
      },
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  it('applies correct tier limits', async () => {
    const limiter = createTiered()

    const free = await limiter.check('free:user1')
    expect(free.limit).toBe(10)

    const pro = await limiter.check('pro:user1')
    expect(pro.limit).toBe(100)

    const ent = await limiter.check('ent:user1')
    expect(ent.limit).toBe(1000)
    await limiter.shutdown()
  })

  it('enforces tier limits independently', async () => {
    const limiter = createTiered()

    // Fill free tier
    for (let i = 0; i < 10; i++) {
      await limiter.check('free:user1')
    }
    const denied = await limiter.check('free:user1')
    expect(denied.allowed).toBe(false)

    // Pro tier still has capacity for same "user"
    const proResult = await limiter.check('pro:user1')
    expect(proResult.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('throws on unknown tier', async () => {
    const limiter = createTieredLimiter({
      tiers: [{ name: 'basic', algorithm: fixedWindow({ limit: 5, window: '1m' }) }],
      resolveTier: () => 'nonexistent',
      store: memoryStore({ cleanupInterval: 0 }),
    })

    await expect(limiter.check('user:1')).rejects.toThrow('Unknown tier')
    await limiter.shutdown()
  })

  it('reset works per tier', async () => {
    const limiter = createTiered()

    for (let i = 0; i < 10; i++) {
      await limiter.check('free:user1')
    }
    await limiter.reset('free:user1')

    const result = await limiter.check('free:user1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })
})

import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { tokenBucket } from '../../src/algorithms/token-bucket.js'
import { createDynamicLimiter } from '../../src/limiter/dynamic.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createDynamicLimiter', () => {
  it('resolves algorithm per context', async () => {
    const limiter = createDynamicLimiter({
      algorithm: (ctx: string) => {
        if (ctx.startsWith('vip:')) {
          return fixedWindow({ limit: 1000, window: '1m' })
        }
        return fixedWindow({ limit: 10, window: '1m' })
      },
      store: memoryStore({ cleanupInterval: 0 }),
    })

    const vip = await limiter.check('vip:user')
    expect(vip.limit).toBe(1000)

    const normal = await limiter.check('regular:user')
    expect(normal.limit).toBe(10)
    await limiter.shutdown()
  })

  it('enforces per-key limits', async () => {
    const limiter = createDynamicLimiter({
      algorithm: () => fixedWindow({ limit: 2, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })

    await limiter.check('user:1')
    await limiter.check('user:1')
    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('reset works', async () => {
    const limiter = createDynamicLimiter({
      algorithm: () => fixedWindow({ limit: 1, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })

    await limiter.check('user:1')
    await limiter.reset('user:1')

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })
})

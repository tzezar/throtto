import { describe, expect, it, vi } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { withSoftHardLimit } from '../../src/limiter/soft-hard.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withSoftHardLimit', () => {
  function createTestLimiter(limit = 10) {
    return createLimiter({
      algorithm: fixedWindow({ limit, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  it('returns warning=false below soft limit', async () => {
    const limiter = withSoftHardLimit(createTestLimiter(10), {
      softLimit: 5,
      hardLimit: 10,
    })

    const result = (await limiter.check('user:1')) as any
    expect(result.allowed).toBe(true)
    expect(result.warning).toBe(false)
    await limiter.shutdown()
  })

  it('returns warning=true above soft limit', async () => {
    const limiter = withSoftHardLimit(createTestLimiter(10), {
      softLimit: 3,
      hardLimit: 10,
    })

    // Use 3 requests (crosses soft limit at 3)
    for (let i = 0; i < 3; i++) {
      await limiter.check('user:1')
    }

    const result = (await limiter.check('user:1')) as any
    expect(result.allowed).toBe(true)
    expect(result.warning).toBe(true)
    await limiter.shutdown()
  })

  it('fires onSoftLimit callback', async () => {
    const onSoftLimit = vi.fn()
    const limiter = withSoftHardLimit(createTestLimiter(10), {
      softLimit: 3,
      hardLimit: 10,
      onSoftLimit,
    })

    for (let i = 0; i < 4; i++) {
      await limiter.check('user:1')
    }

    expect(onSoftLimit).toHaveBeenCalled()
    await limiter.shutdown()
  })

  it('denies above hard limit', async () => {
    const limiter = withSoftHardLimit(createTestLimiter(5), {
      softLimit: 3,
      hardLimit: 5,
    })

    for (let i = 0; i < 5; i++) {
      await limiter.check('user:1')
    }

    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })
})

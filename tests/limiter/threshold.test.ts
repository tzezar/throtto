import { describe, expect, it, vi } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { withThresholds } from '../../src/limiter/threshold.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withThresholds', () => {
  function createTestLimiter(limit = 10) {
    return createLimiter({
      algorithm: fixedWindow({ limit, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  it('fires threshold when usage crosses percent', async () => {
    const onThreshold = vi.fn()
    const limiter = withThresholds(createTestLimiter(10), {
      thresholds: [{ percent: 50, onThreshold }],
    })

    // Use 4 (40%) - no fire
    for (let i = 0; i < 4; i++) {
      await limiter.check('user:1')
    }
    expect(onThreshold).not.toHaveBeenCalled()

    // Use 5th (50%) - fires
    await limiter.check('user:1')
    expect(onThreshold).toHaveBeenCalledTimes(1)
    await limiter.shutdown()
  })

  it('fires multiple thresholds', async () => {
    const on50 = vi.fn()
    const on80 = vi.fn()
    const limiter = withThresholds(createTestLimiter(10), {
      thresholds: [
        { percent: 50, onThreshold: on50 },
        { percent: 80, onThreshold: on80 },
      ],
    })

    for (let i = 0; i < 8; i++) {
      await limiter.check('user:1')
    }

    expect(on50).toHaveBeenCalled()
    expect(on80).toHaveBeenCalled()
    await limiter.shutdown()
  })

  it('fires only once per window when once=true', async () => {
    const onThreshold = vi.fn()
    const limiter = withThresholds(createTestLimiter(10), {
      thresholds: [{ percent: 50, onThreshold, once: true }],
    })

    for (let i = 0; i < 8; i++) {
      await limiter.check('user:1')
    }

    expect(onThreshold).toHaveBeenCalledTimes(1)
    await limiter.shutdown()
  })

  it('fires every time when once=false', async () => {
    const onThreshold = vi.fn()
    const limiter = withThresholds(createTestLimiter(10), {
      thresholds: [{ percent: 50, onThreshold, once: false }],
    })

    for (let i = 0; i < 8; i++) {
      await limiter.check('user:1')
    }

    // Fires for 50%, 60%, 70%, 80% (4 times)
    expect(onThreshold).toHaveBeenCalledTimes(4)
    await limiter.shutdown()
  })

  it('tracks thresholds per key', async () => {
    const onThreshold = vi.fn()
    const limiter = withThresholds(createTestLimiter(10), {
      thresholds: [{ percent: 50, onThreshold }],
    })

    for (let i = 0; i < 6; i++) {
      await limiter.check('user:1')
    }
    for (let i = 0; i < 6; i++) {
      await limiter.check('user:2')
    }

    expect(onThreshold).toHaveBeenCalledTimes(2)
    await limiter.shutdown()
  })
})

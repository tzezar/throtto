import { describe, expect, it, vi } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { withDryRun } from '../../src/limiter/dry-run.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withDryRun', () => {
  function createTestLimiter() {
    return createLimiter({
      algorithm: fixedWindow({ limit: 1, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  it('allows requests that would be denied', async () => {
    const limiter = withDryRun(createTestLimiter())

    await limiter.check('user:1')
    // Would normally be denied
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('fires onShadowDeny when request would be denied', async () => {
    const onShadowDeny = vi.fn()
    const limiter = withDryRun(createTestLimiter(), { onShadowDeny })

    await limiter.check('user:1')
    await limiter.check('user:1')

    expect(onShadowDeny).toHaveBeenCalledTimes(1)
    await limiter.shutdown()
  })

  it('does not fire onShadowDeny for allowed requests', async () => {
    const onShadowDeny = vi.fn()
    const limiter = withDryRun(createTestLimiter(), { onShadowDeny })

    await limiter.check('user:1')
    expect(onShadowDeny).not.toHaveBeenCalled()
    await limiter.shutdown()
  })

  it('consume never throws', async () => {
    const limiter = withDryRun(createTestLimiter())

    await limiter.consume('user:1')
    // Should not throw
    const result = await limiter.consume('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('peek still works normally', async () => {
    const limiter = withDryRun(createTestLimiter())

    await limiter.check('user:1')
    const info = await limiter.peek('user:1')
    expect(info).not.toBeNull()
    await limiter.shutdown()
  })
})

import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { createLazyLimiter } from '../../src/limiter/lazy.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createLazyLimiter', () => {
  function factory() {
    return createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  it('initializes on first check', async () => {
    const limiter = createLazyLimiter(factory)
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('works normally after initialization', async () => {
    const limiter = createLazyLimiter(factory, { pendingBehavior: 'queue' })

    // First check triggers init and queues - will resolve once ready
    const firstResult = await limiter.check('user:1')
    expect(firstResult.allowed).toBe(true)

    // Now initialized - use remaining 4
    for (let i = 0; i < 4; i++) {
      await limiter.check('user:1')
    }

    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('allows during initialization when pendingBehavior=allow', async () => {
    const limiter = createLazyLimiter(factory, { pendingBehavior: 'allow' })
    // First call triggers init, returns allow immediately
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('handles factory error with fail-open', async () => {
    const limiter = createLazyLimiter(
      () => {
        throw new Error('connection failed')
      },
      { failMode: 'open' },
    )

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('handles factory error with fail-closed', async () => {
    const limiter = createLazyLimiter(
      async () => {
        throw new Error('connection failed')
      },
      { failMode: 'closed', pendingBehavior: 'queue' },
    )

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('supports async factory', async () => {
    const limiter = createLazyLimiter(async () => {
      // Simulate async init
      return factory()
    })

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('peek returns null before initialization', async () => {
    const limiter = createLazyLimiter(factory)
    const info = await limiter.peek('user:1')
    expect(info).toBeNull()
    await limiter.shutdown()
  })
})

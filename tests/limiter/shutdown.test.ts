import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { withGracefulShutdown } from '../../src/limiter/shutdown.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withGracefulShutdown', () => {
  function createTestLimiter() {
    return createLimiter({
      algorithm: fixedWindow({ limit: 10, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  it('works normally before shutdown', async () => {
    const limiter = withGracefulShutdown(createTestLimiter())
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('allows requests after shutdown when onNewRequest=allow', async () => {
    const limiter = withGracefulShutdown(createTestLimiter(), { onNewRequest: 'allow' })

    await limiter.shutdown()
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
  })

  it('denies requests after shutdown when onNewRequest=deny', async () => {
    const limiter = withGracefulShutdown(createTestLimiter(), { onNewRequest: 'deny' })

    await limiter.shutdown()
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(false)
  })

  it('shutdown resolves when no in-flight operations', async () => {
    const limiter = withGracefulShutdown(createTestLimiter(), { drainTimeout: 100 })
    await expect(limiter.shutdown()).resolves.toBeUndefined()
  })

  it('peek returns null after shutdown', async () => {
    const limiter = withGracefulShutdown(createTestLimiter())
    await limiter.check('user:1')
    await limiter.shutdown()
    const info = await limiter.peek('user:1')
    expect(info).toBeNull()
  })
})

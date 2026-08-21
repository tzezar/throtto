import { describe, expect, it } from 'vitest'
import { createTestLimiter } from '../../src/testing/test-limiter.js'

describe('createTestLimiter', () => {
  it('creates limiter with defaults', async () => {
    const { limiter, clock, store } = createTestLimiter()
    const result = await limiter.check('user-1')
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(10) // default limit
    await limiter.shutdown()
  })

  it('respects custom limit and window', async () => {
    const { limiter } = createTestLimiter({ limit: 2, window: '10s' })
    await limiter.check('key')
    await limiter.check('key')
    const denied = await limiter.check('key')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('clock controls time', async () => {
    const { limiter, clock } = createTestLimiter({ limit: 1, window: '1m' })
    await limiter.check('key') // uses 1/1
    const denied = await limiter.check('key')
    expect(denied.allowed).toBe(false)

    clock.advance(120_001) // advance past 2× window (sliding-window-counter interpolates)
    const allowed = await limiter.check('key')
    expect(allowed.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('store is accessible for inspection', async () => {
    const { limiter, store } = createTestLimiter({ prefix: 'test:' })
    await limiter.check('user-1')
    // Store should have the entry
    const entry = await store.get('test:user-1')
    expect(entry).not.toBeNull()
    await limiter.shutdown()
  })

  it('supports custom algorithm', async () => {
    const { limiter } = createTestLimiter({ limit: 5, window: '1m', algorithm: 'fixed-window' })
    const result = await limiter.check('user-1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })
})

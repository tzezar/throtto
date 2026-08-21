import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLimiter, fixedWindow, memoryStore } from '../../src/index.js'
import type { Limiter, RateLimitResult } from '../../src/index.js'
import { testClock } from '../../src/testing/clock.js'
import { assertAllowed, assertDenied } from '../../src/testing/helpers.js'
import { mockStore } from '../../src/testing/mock-store.js'

describe('integration: graceful-degradation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('failMode "open" allows requests when store fails on get', async () => {
    const failing = mockStore({ failOn: ['get', 'atomic'] })

    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store: failing,
      failMode: 'open',
    })

    const result = await limiter.check('user:1')
    // failMode open → allowed through despite store failure
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(0) // degraded result
    await limiter.shutdown()
  })

  it('failMode "closed" denies requests when store fails on get', async () => {
    const failing = mockStore({ failOn: ['get', 'atomic'] })

    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store: failing,
      failMode: 'closed',
    })

    const result = await limiter.check('user:1')
    // failMode closed → denied when store fails
    expect(result.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('mockStore failAfter simulates intermittent failures', async () => {
    // Allow the first 3 operations, then fail all subsequent
    const store = mockStore({ failAfter: 3 })
    const errors: unknown[] = []

    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 10, window: '1m' }),
      store,
      failMode: 'open',
      hooks: {
        onError: (_key, error) => errors.push(error),
      },
    })

    // First check succeeds (2 ops: atomic call records + inner get/set)
    const r1 = await limiter.check('user:1')
    assertAllowed(r1)

    // After failAfter ops, store will throw
    // Keep checking until failure mode kicks in
    let sawDegraded = false
    for (let i = 0; i < 10; i++) {
      const r = await limiter.check('user:1')
      if (r.limit === 0 && r.allowed) {
        sawDegraded = true
        break
      }
    }

    expect(sawDegraded).toBe(true)
    expect(errors.length).toBeGreaterThan(0)
    await limiter.shutdown()
  })

  it('fallback store is used when primary store fails', async () => {
    const primary = mockStore({ failOn: ['get', 'set', 'atomic'] })
    const fallback = memoryStore({ cleanupInterval: 0 })

    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store: primary,
      fallbackStore: fallback,
    })

    // Primary fails → fallback should serve the request
    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(true)
    expect(r1.limit).toBe(5) // real limit, not degraded

    const r2 = await limiter.check('user:1')
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(3) // fallback is actually tracking state

    await limiter.shutdown()
    await fallback.shutdown()
  })

  it('fallback store tracks state independently when primary fails', async () => {
    const primary = mockStore({ failOn: ['get', 'set', 'atomic'] })
    const fallback = memoryStore({ cleanupInterval: 0 })

    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 2, window: '1m' }),
      store: primary,
      fallbackStore: fallback,
    })

    // Exhaust limit on fallback store
    await limiter.check('key')
    await limiter.check('key')
    const denied = await limiter.check('key')
    expect(denied.allowed).toBe(false)

    await limiter.shutdown()
    await fallback.shutdown()
  })

  it('onError hook fires with store errors', async () => {
    const failing = mockStore({ failOn: ['get', 'atomic'] })
    const errors: Array<{ key: string; error: unknown }> = []

    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store: failing,
      failMode: 'open',
      hooks: {
        onError: (key, error) => errors.push({ key, error }),
      },
    })

    await limiter.check('user:1')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.key).toBe('user:1')
    expect(errors[0]?.error).toBeInstanceOf(Error)
    await limiter.shutdown()
  })
})

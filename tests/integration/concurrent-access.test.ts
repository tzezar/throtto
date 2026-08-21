import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLimiter, fixedWindow, memoryStore, rateLimit } from '../../src/index.js'
import type { Limiter, RateLimitResult } from '../../src/index.js'
import { testClock } from '../../src/testing/clock.js'
import { assertAllowed, assertDenied } from '../../src/testing/helpers.js'

describe('integration: concurrent-access', () => {
  it('concurrent checks with limit=50: exactly 50 allowed out of 100', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 50, window: '1m' }),
      store,
    })

    // Fire 100 concurrent checks
    const promises: Array<Promise<RateLimitResult>> = []
    for (let i = 0; i < 100; i++) {
      promises.push(limiter.check('shared-key'))
    }
    const results = await Promise.all(promises)

    const allowed = results.filter((r) => r.allowed)
    const denied = results.filter((r) => !r.allowed)

    // Memory store uses atomic (synchronous), so exactly 50 should be allowed
    expect(allowed).toHaveLength(50)
    expect(denied).toHaveLength(50)

    await limiter.shutdown()
  })

  it('concurrent checks across different keys are independent', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 3, window: '1m' }),
      store,
    })

    // Fire concurrent checks for 5 different keys, 3 checks each
    const promises: Array<Promise<{ key: string; result: RateLimitResult }>> = []
    for (let keyIdx = 0; keyIdx < 5; keyIdx++) {
      for (let checkIdx = 0; checkIdx < 3; checkIdx++) {
        const key = `user:${keyIdx}`
        promises.push(limiter.check(key).then((result) => ({ key, result })))
      }
    }
    const results = await Promise.all(promises)

    // Group by key
    const byKey = new Map<string, RateLimitResult[]>()
    for (const { key, result } of results) {
      const existing = byKey.get(key) ?? []
      existing.push(result)
      byKey.set(key, existing)
    }

    // Each key should have exactly 3 allowed (limit=3)
    for (const [key, keyResults] of byKey) {
      const allowed = keyResults.filter((r) => r.allowed)
      expect(allowed).toHaveLength(3)
    }

    await limiter.shutdown()
  })

  it('concurrent consume calls respect limit', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 10, window: '1m' }),
      store,
    })

    // Fire 20 concurrent consume calls
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => limiter.consume('key')),
    )

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    // Exactly 10 should succeed, 10 should throw RateLimitExceededError
    expect(fulfilled).toHaveLength(10)
    expect(rejected).toHaveLength(10)

    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(Error)
    }

    await limiter.shutdown()
  })

  it('multiple limiters sharing same store with different prefixes do not interfere', async () => {
    const store = memoryStore({ cleanupInterval: 0 })

    const limiterA = createLimiter({
      algorithm: fixedWindow({ limit: 3, window: '1m' }),
      store,
      prefix: 'svc-a:',
    })

    const limiterB = createLimiter({
      algorithm: fixedWindow({ limit: 3, window: '1m' }),
      store,
      prefix: 'svc-b:',
    })

    // Fire concurrent checks on the same logical key but different prefixes
    const promises = [
      ...Array.from({ length: 5 }, () => limiterA.check('user')),
      ...Array.from({ length: 5 }, () => limiterB.check('user')),
    ]
    const results = await Promise.all(promises)

    const resultsA = results.slice(0, 5)
    const resultsB = results.slice(5)

    // Each limiter allows 3 independently
    expect(resultsA.filter((r) => r.allowed)).toHaveLength(3)
    expect(resultsA.filter((r) => !r.allowed)).toHaveLength(2)
    expect(resultsB.filter((r) => r.allowed)).toHaveLength(3)
    expect(resultsB.filter((r) => !r.allowed)).toHaveLength(2)

    await limiterA.shutdown()
    // store already shut down by limiterA, but limiterB shutdown should be safe
  })

  it('concurrent checks on shared store with same prefix correctly share state', async () => {
    const store = memoryStore({ cleanupInterval: 0 })

    const limiter1 = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store,
      prefix: 'shared:',
    })

    const limiter2 = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store,
      prefix: 'shared:',
    })

    // Fire concurrent checks from both limiters on the same key
    const promises = [
      ...Array.from({ length: 5 }, () => limiter1.check('key')),
      ...Array.from({ length: 5 }, () => limiter2.check('key')),
    ]
    const results = await Promise.all(promises)

    // Total allowed across both limiters should be 5 (shared state via same store+prefix)
    const totalAllowed = results.filter((r) => r.allowed).length
    expect(totalAllowed).toBe(5)

    await limiter1.shutdown()
  })

  it('rapid sequential checks produce consistent remaining counts', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 10, window: '1m' }),
      store,
    })

    const results: RateLimitResult[] = []
    for (let i = 0; i < 10; i++) {
      results.push(await limiter.check('key'))
    }

    // Each successive allowed result should have decreasing remaining
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(10 - i - 1)
    }

    // 11th should be denied
    const denied = await limiter.check('key')
    assertDenied(denied)

    await limiter.shutdown()
  })

  it('concurrent exhaust + reset race: system remains consistent', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 20, window: '1m' }),
      store,
    })

    // Fire 30 concurrent checks AND a reset mid-way
    const checkPromises = Array.from({ length: 30 }, (_, i) => {
      if (i === 15) {
        // Reset mid-way
        return limiter.reset('race-key').then(() => null)
      }
      return limiter.check('race-key')
    })

    const results = await Promise.all(checkPromises)

    // Filter out the null from reset
    const checkResults = results.filter((r): r is RateLimitResult => r !== null)

    // Some results should be allowed and some may be denied
    // The key invariant: no crashes, all results are valid RateLimitResult
    for (const r of checkResults) {
      expect(r).toHaveProperty('allowed')
      expect(r).toHaveProperty('limit')
      expect(r).toHaveProperty('remaining')
    }

    // After all that, the limiter should still work
    const finalResult = await limiter.check('race-key')
    expect(finalResult).toHaveProperty('allowed')

    await limiter.shutdown()
  })

  it('concurrent checks with varying costs respect total capacity', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 10, window: '1m' }),
      store,
    })

    // Fire concurrent checks with cost=2 each (should allow 5)
    const promises = Array.from({ length: 8 }, () => limiter.check('key', { cost: 2 }))
    const results = await Promise.all(promises)

    const allowed = results.filter((r) => r.allowed)
    const denied = results.filter((r) => !r.allowed)

    // With limit=10 and cost=2, exactly 5 should be allowed
    expect(allowed).toHaveLength(5)
    expect(denied).toHaveLength(3)

    await limiter.shutdown()
  })
})

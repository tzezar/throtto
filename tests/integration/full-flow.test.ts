import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withAnalytics } from '../../src/analytics/index.js'
import {
  createCompoundLimiter,
  createLimiter,
  fixedWindow,
  isAllowed,
  isDenied,
  memoryStore,
  rateLimit,
  slidingWindowCounter,
  toHeaders,
  tokenBucket,
  withAllowlist,
  withBatch,
  withDryRun,
  withThresholds,
} from '../../src/index.js'
import type { DeniedResult, Limiter, RateLimitResult } from '../../src/index.js'
import { exportState, importState } from '../../src/limiter/export-import.js'
import { withOverride } from '../../src/limiter/override.js'
import { testClock } from '../../src/testing/clock.js'
import { assertAllowed, assertDenied, exhaust } from '../../src/testing/helpers.js'

describe('integration: full-flow', () => {
  let limiter: Limiter

  afterEach(async () => {
    if (limiter) await limiter.shutdown()
  })

  it('allowlisted keys bypass rate limiting', async () => {
    const base = rateLimit('2/minute', { store: memoryStore({ cleanupInterval: 0 }) })
    limiter = withAllowlist(base, { allowlist: ['admin'] })

    // Admin is allowlisted - always passes, even beyond limit
    for (let i = 0; i < 10; i++) {
      const r = await limiter.check('admin')
      expect(r.allowed).toBe(true)
    }

    // Normal user gets rate limited after 2
    await limiter.check('user:1')
    await limiter.check('user:1')
    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)
  })

  it('dry-run mode allows everything but fires shadow deny hooks', async () => {
    const shadowDenies: Array<{ key: string; result: RateLimitResult }> = []
    const base = rateLimit('1/minute', { store: memoryStore({ cleanupInterval: 0 }) })
    limiter = withDryRun(base, {
      onShadowDeny: (key, result) => shadowDenies.push({ key, result }),
    })

    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(true)

    // Second call would be denied but dry-run converts it to allowed
    const r2 = await limiter.check('user:1')
    expect(r2.allowed).toBe(true)

    // Shadow deny hook was fired
    expect(shadowDenies).toHaveLength(1)
    expect(shadowDenies[0]?.key).toBe('user:1')
  })

  it('allowlist + dry-run composed: allowlisted bypasses, dry-run catches the rest', async () => {
    const shadowDenies: string[] = []
    const base = rateLimit('1/minute', { store: memoryStore({ cleanupInterval: 0 }) })
    const withAl = withAllowlist(base, { allowlist: ['vip'] })
    limiter = withDryRun(withAl, {
      onShadowDeny: (key) => shadowDenies.push(key),
    })

    // VIP always passes (allowlist short-circuits before dry-run even checks)
    for (let i = 0; i < 5; i++) {
      const r = await limiter.check('vip')
      expect(r.allowed).toBe(true)
    }
    expect(shadowDenies).toHaveLength(0)

    // Normal user: first allowed, second would be denied → dry-run allows with shadow
    await limiter.check('user:2')
    await limiter.check('user:2')
    expect(shadowDenies).toHaveLength(1)
    expect(shadowDenies[0]).toBe('user:2')
  })

  it('exhaust limiter then verify deny, check toHeaders produces valid headers', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    limiter = rateLimit('3/minute', { store })

    const results = await exhaust(limiter, 'api-key', 4)

    // First 3 allowed, 4th denied
    assertAllowed(results[0]!)
    assertAllowed(results[1]!)
    assertAllowed(results[2]!)
    assertDenied(results[3]!)

    const denied = results[3]!
    const headers = toHeaders(denied)
    expect(headers).toHaveProperty('RateLimit')
    expect(headers).toHaveProperty('Retry-After')
    expect(headers.RateLimit).toContain('limit=3')
    expect(headers.RateLimit).toContain('remaining=0')
  })

  it('toHeaders with legacy format', async () => {
    limiter = rateLimit('2/second', { store: memoryStore({ cleanupInterval: 0 }) })

    await exhaust(limiter, 'key', 3)
    const denied = await limiter.check('key')
    const headers = toHeaders(denied, { format: 'legacy' })

    expect(headers).toHaveProperty('X-RateLimit-Limit')
    expect(headers).toHaveProperty('X-RateLimit-Remaining')
    expect(headers).toHaveProperty('X-RateLimit-Reset')
  })

  it('withOverride: normal flow, then force-allow, then force-deny', async () => {
    const base = rateLimit('2/minute', { store: memoryStore({ cleanupInterval: 0 }) })
    const overrideLimiter = withOverride(base)
    limiter = overrideLimiter

    // Normal flow - exhaust limit
    await overrideLimiter.check('user:1')
    await overrideLimiter.check('user:1')
    const denied = await overrideLimiter.check('user:1')
    expect(denied.allowed).toBe(false)

    // Set override to force-allow
    overrideLimiter.setOverride('user:1', { action: 'allow' })
    const forceAllowed = await overrideLimiter.check('user:1')
    expect(forceAllowed.allowed).toBe(true)

    // Change override to force-deny
    overrideLimiter.setOverride('user:1', { action: 'deny', reason: 'abusive' })
    const forceDenied = await overrideLimiter.check('user:1')
    expect(forceDenied.allowed).toBe(false)

    // Remove override - back to normal (still exhausted)
    overrideLimiter.removeOverride('user:1')
    const backToNormal = await overrideLimiter.check('user:1')
    expect(backToNormal.allowed).toBe(false)
  })

  it('compound limiter enforces multi-layer limits', async () => {
    const compound = createCompoundLimiter([
      {
        name: 'per-second',
        limiter: rateLimit('2/second', { store: memoryStore({ cleanupInterval: 0 }) }),
      },
      {
        name: 'per-minute',
        limiter: rateLimit('5/minute', { store: memoryStore({ cleanupInterval: 0 }) }),
      },
    ])
    limiter = compound

    // First 2 allowed (per-second)
    const r1 = await compound.check('key')
    const r2 = await compound.check('key')
    assertAllowed(r1)
    assertAllowed(r2)

    // 3rd denied by per-second
    const r3 = await compound.check('key')
    expect(r3.allowed).toBe(false)
  })

  it('export state from one store, import to another, verify state preserved', async () => {
    const store1 = memoryStore({ cleanupInterval: 0 })
    const store2 = memoryStore({ cleanupInterval: 0 })

    limiter = createLimiter({
      algorithm: fixedWindow({ limit: 10, window: '1m' }),
      store: store1,
    })

    // Consume some capacity
    await limiter.check('key-a')
    await limiter.check('key-a')
    await limiter.check('key-b')

    // Export from store1
    const exported = await exportState(store1, ['key-a', 'key-b'])
    expect(exported.version).toBe(1)
    expect(exported.entries).toHaveLength(2)

    // Import into store2
    const result = await importState(store2, exported, { conflictStrategy: 'overwrite' })
    expect(result.imported).toBe(2)
    expect(result.errors).toHaveLength(0)

    // Verify state is present in store2
    const entry = await store2.get('key-a')
    expect(entry).not.toBeNull()
    expect(entry?.state).toBeDefined()
  })

  it('full lifecycle: check → consume → peek → reset → check again', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    limiter = createLimiter({
      algorithm: fixedWindow({ limit: 3, window: '1m' }),
      store,
    })

    // check
    const r1 = await limiter.check('user:1')
    assertAllowed(r1)
    expect(r1.remaining).toBe(2)

    // consume
    const consumed = await limiter.consume('user:1')
    expect(consumed.allowed).toBe(true)
    expect(consumed.remaining).toBe(1)

    // peek (should not consume)
    const info = await limiter.peek('user:1')
    expect(info).not.toBeNull()
    expect(info?.remaining).toBeGreaterThanOrEqual(1)

    // consume last one
    await limiter.consume('user:1')

    // next check should deny
    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)

    // reset
    await limiter.reset('user:1')

    // check again - should be allowed after reset
    const afterReset = await limiter.check('user:1')
    assertAllowed(afterReset)
    expect(afterReset.remaining).toBe(2)
  })

  it('testClock controls time in multi-step scenarios', async () => {
    const clock = testClock(Date.now())
    const store = memoryStore({ cleanupInterval: 0 })

    limiter = createLimiter({
      algorithm: fixedWindow({ limit: 2, window: 60_000 }),
      store,
      clock,
    })

    // Exhaust limit
    await limiter.check('user:1')
    await limiter.check('user:1')
    const denied = await limiter.check('user:1')
    expect(denied.allowed).toBe(false)

    // Advance clock past the window
    clock.advance(61_000)

    // Should be allowed again in new window
    const afterWindow = await limiter.check('user:1')
    assertAllowed(afterWindow)
    expect(afterWindow.remaining).toBe(1)
  })

  it('testClock with token bucket: tokens refill over time', async () => {
    const clock = testClock(Date.now())
    const store = memoryStore({ cleanupInterval: 0 })

    limiter = createLimiter({
      algorithm: tokenBucket({ capacity: 3, refillRate: 1, interval: 1_000 }),
      store,
      clock,
    })

    // Drain all 3 tokens
    assertAllowed(await limiter.check('key'))
    assertAllowed(await limiter.check('key'))
    assertAllowed(await limiter.check('key'))
    assertDenied(await limiter.check('key'))

    // Advance 2 seconds → 2 tokens refilled
    clock.advance(2_000)
    assertAllowed(await limiter.check('key'))
    assertAllowed(await limiter.check('key'))
    assertDenied(await limiter.check('key'))
  })

  it('withAnalytics captures events and metrics', async () => {
    const base = rateLimit('3/minute', { store: memoryStore({ cleanupInterval: 0 }) })
    const analyticsLimiter = withAnalytics(base)
    limiter = analyticsLimiter

    // Make some checks
    await analyticsLimiter.check('user:1')
    await analyticsLimiter.check('user:1')
    await analyticsLimiter.check('user:1')
    await analyticsLimiter.check('user:1') // should be denied

    const metrics = analyticsLimiter.getMetrics()
    expect(metrics.totalRequests).toBe(4)
    expect(metrics.allowedRequests).toBe(3)
    expect(metrics.deniedRequests).toBe(1)
    expect(metrics.denyRate).toBeCloseTo(0.25, 2)

    const topKeys = metrics.topKeys
    expect(topKeys.length).toBeGreaterThan(0)
    expect(topKeys[0]?.key).toBe('user:1')
    expect(topKeys[0]?.count).toBe(4)
  })

  it('withAnalytics resetAnalytics clears metrics', async () => {
    const base = rateLimit('5/minute', { store: memoryStore({ cleanupInterval: 0 }) })
    const analyticsLimiter = withAnalytics(base)
    limiter = analyticsLimiter

    await analyticsLimiter.check('key')
    await analyticsLimiter.check('key')
    expect(analyticsLimiter.getMetrics().totalRequests).toBe(2)

    analyticsLimiter.resetAnalytics()
    expect(analyticsLimiter.getMetrics().totalRequests).toBe(0)
  })

  it('batch check: withBatch processes multiple keys', async () => {
    const base = rateLimit('5/minute', { store: memoryStore({ cleanupInterval: 0 }) })
    const batchLimiter = withBatch(base)
    limiter = batchLimiter

    const results = await batchLimiter.checkMany([
      { ctx: 'user:1' },
      { ctx: 'user:2' },
      { ctx: 'user:3' },
    ])

    expect(results).toHaveLength(3)
    for (const r of results) {
      expect(r.allowed).toBe(true)
    }

    // Each key used 1 of 5
    const r1 = await batchLimiter.check('user:1')
    expect(r1.remaining).toBe(3)
  })

  it('withThresholds fires callbacks at usage thresholds', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const base = createLimiter({
      algorithm: fixedWindow({ limit: 10, window: '1m' }),
      store,
    })

    const fired: Array<{ percent: number; key: string }> = []

    limiter = withThresholds(base, {
      thresholds: [
        { percent: 50, onThreshold: (key, pct) => fired.push({ percent: pct, key }) },
        { percent: 90, onThreshold: (key, pct) => fired.push({ percent: pct, key }) },
      ],
    })

    // Use 5 of 10 → 50% threshold
    for (let i = 0; i < 5; i++) {
      await limiter.check('key')
    }
    expect(fired.some((f) => f.percent >= 50)).toBe(true)

    // Use up to 9 of 10 → 90% threshold
    for (let i = 0; i < 4; i++) {
      await limiter.check('key')
    }
    expect(fired.some((f) => f.percent >= 90)).toBe(true)
  })

  it('isAllowed and isDenied type guards work correctly', async () => {
    limiter = rateLimit('1/minute', { store: memoryStore({ cleanupInterval: 0 }) })

    const allowed = await limiter.check('key')
    expect(isAllowed(allowed)).toBe(true)
    expect(isDenied(allowed)).toBe(false)
    if (isAllowed(allowed)) {
      expect(allowed.cost).toBe(1)
    }

    const denied = await limiter.check('key')
    expect(isAllowed(denied)).toBe(false)
    expect(isDenied(denied)).toBe(true)
    if (isDenied(denied)) {
      expect(denied.retryAfter).toBeGreaterThanOrEqual(0)
    }
  })

  it('rateLimit preset with prefix keeps keys namespaced', async () => {
    const store = memoryStore({ cleanupInterval: 0 })

    const limiterA = rateLimit('2/minute', { store, prefix: 'api:' })
    const limiterB = rateLimit('2/minute', { store, prefix: 'web:' })

    // Exhaust limiterA's limit for 'user'
    await limiterA.check('user')
    await limiterA.check('user')
    const deniedA = await limiterA.check('user')
    expect(deniedA.allowed).toBe(false)

    // limiterB should still allow 'user' (different prefix)
    const allowedB = await limiterB.check('user')
    expect(allowedB.allowed).toBe(true)

    limiter = limiterA
    await limiterB.shutdown()
  })
})

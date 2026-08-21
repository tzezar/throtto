import { afterEach, describe, expect, it, vi } from 'vitest'
import { rateLimit as expressRateLimit } from '../../src/adapters/express.js'
import type {
  ExpressNextFunction,
  ExpressRequest,
  ExpressResponse,
} from '../../src/adapters/express.js'
import {
  ConfigError,
  createLimiter,
  fixedWindow,
  memoryStore,
  pipe,
  rateLimit,
  shouldSkip,
  toErrorBody,
  tokenBucket,
  withAllowlist,
  withDryRun,
  withOverride,
} from '../../src/index.js'
import type { DeniedResult, Limiter } from '../../src/index.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLimiter(limit = 5, windowMs = 60_000): Limiter {
  const store = memoryStore({ cleanupInterval: 0 })
  return createLimiter({
    algorithm: fixedWindow({ limit, window: windowMs }),
    store,
  })
}

let activeLimiter: Limiter | undefined

afterEach(async () => {
  if (activeLimiter) {
    await activeLimiter.shutdown()
    activeLimiter = undefined
  }
})

// ─── 1. pipe() ───────────────────────────────────────────────────────────────

describe('pipe()', () => {
  it('with no transforms returns the limiter unchanged', () => {
    const limiter = makeLimiter()
    activeLimiter = limiter
    const piped = pipe(limiter)
    expect(piped).toBe(limiter)
  })

  it('with multiple transforms applies left-to-right', async () => {
    const order: string[] = []
    const t1 = (l: Limiter): Limiter => {
      order.push('t1')
      return l
    }
    const t2 = (l: Limiter): Limiter => {
      order.push('t2')
      return l
    }
    const t3 = (l: Limiter): Limiter => {
      order.push('t3')
      return l
    }

    const limiter = makeLimiter()
    activeLimiter = limiter
    pipe(limiter, t1, t2, t3)

    expect(order).toEqual(['t1', 't2', 't3'])
  })

  it('with allowlist + dry-run composes correctly', async () => {
    const base = rateLimit({ limit: 1, window: '1m' })
    activeLimiter = base

    const composed = pipe(base, withAllowlist({ allowlist: ['admin'] }), withDryRun())

    // admin is allowlisted - always allowed
    const adminResult = await composed.check('admin')
    expect(adminResult.allowed).toBe(true)

    // Exhaust the limit for a regular user
    await composed.check('user')
    // Second check would be denied, but dry-run converts to allowed
    const dryResult = await composed.check('user')
    expect(dryResult.allowed).toBe(true)
  })
})

// ─── 2. Curried wrappers ─────────────────────────────────────────────────────

describe('curried wrappers', () => {
  it('withAllowlist({ allowlist }) returns a function that wraps a limiter', async () => {
    const transform = withAllowlist({ allowlist: ['admin'] })
    expect(typeof transform).toBe('function')

    const base = makeLimiter(1)
    activeLimiter = base

    const wrapped = transform(base)

    // admin bypasses limits
    const result = await wrapped.check('admin')
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(0) // bypass result has limit 0
  })

  it('withDryRun() returns a function (no args) that wraps a limiter in dry-run', async () => {
    const transform = withDryRun()
    expect(typeof transform).toBe('function')

    const base = makeLimiter(1)
    activeLimiter = base

    const wrapped = transform(base)

    // Exhaust limit
    await wrapped.check('user')
    // Would be denied but dry-run converts to allowed
    const result = await wrapped.check('user')
    expect(result.allowed).toBe(true)
  })

  it('withOverride() returns a function that adds override methods', () => {
    const transform = withOverride()
    expect(typeof transform).toBe('function')

    const base = makeLimiter()
    activeLimiter = base

    const wrapped = transform(base)

    // Should have override methods
    expect(typeof wrapped.setOverride).toBe('function')
    expect(typeof wrapped.removeOverride).toBe('function')
    expect(typeof wrapped.getOverride).toBe('function')
    expect(typeof wrapped.listOverrides).toBe('function')
    expect(typeof wrapped.clearOverrides).toBe('function')
  })
})

// ─── 3. normalizeKey ─────────────────────────────────────────────────────────

describe('normalizeKey', () => {
  it("'lowercase' makes 'USER-1' and 'user-1' share the same limit", async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 2, window: '1m' }),
      store,
      normalizeKey: 'lowercase',
    })
    activeLimiter = limiter

    await limiter.check('USER-1') // count 1
    await limiter.check('user-1') // count 2 (same normalized key)
    const result = await limiter.check('User-1') // count 3 → denied
    expect(result.allowed).toBe(false)
  })

  it("'trim' makes ' key ' and 'key' share the same limit", async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 2, window: '1m' }),
      store,
      normalizeKey: 'trim',
    })
    activeLimiter = limiter

    await limiter.check(' key ') // count 1
    await limiter.check('key') // count 2 (same normalized key)
    const result = await limiter.check('  key  ') // count 3 → denied
    expect(result.allowed).toBe(false)
  })

  it('custom function normalizer works', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 2, window: '1m' }),
      store,
      normalizeKey: (key) => key.replace(/[^a-z]/gi, '').toLowerCase(),
    })
    activeLimiter = limiter

    await limiter.check('u-s-e-r') // → "user", count 1
    await limiter.check('U.S.E.R') // → "user", count 2
    const result = await limiter.check('USER') // → "user", count 3 → denied
    expect(result.allowed).toBe(false)
  })
})

// ─── 4. Inline limiter in adapters ───────────────────────────────────────────

describe('expressRateLimit inline limiter', () => {
  it('creating middleware with { limit, window } (no separate limiter) works', async () => {
    const middleware = expressRateLimit({ limit: 5, window: '1m' })

    const req: ExpressRequest = {
      ip: '127.0.0.1',
      headers: {},
      method: 'GET',
      path: '/api/test',
    }

    let nextCalled = false
    const next: ExpressNextFunction = () => {
      nextCalled = true
    }

    const res = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      json: vi.fn(),
    } as unknown as ExpressResponse

    // The middleware is async internally, so we need to wait
    middleware(req, res, next)

    // Wait for the async internals to settle
    await vi.waitFor(() => {
      expect(nextCalled).toBe(true)
    })
  })

  it('missing both limiter and limit throws ConfigError', () => {
    expect(() => {
      expressRateLimit({} as never)
    }).toThrow(ConfigError)
  })
})

// ─── 5. (SQL store cleanup - skipped, requires real DB) ──────────────────────

// ─── 6. skipPaths / skipMethods ──────────────────────────────────────────────

describe('shouldSkip', () => {
  it('returns true when path matches skipPaths', () => {
    expect(shouldSkip('/health', 'GET', { skipPaths: ['/health', '/metrics'] })).toBe(true)
  })

  it('returns true when method matches skipMethods', () => {
    expect(shouldSkip('/api/users', 'OPTIONS', { skipMethods: ['OPTIONS'] })).toBe(true)
  })

  it('returns false when neither path nor method match', () => {
    expect(shouldSkip('/api/users', 'GET', { skipPaths: ['/health'] })).toBe(false)
  })
})

// ─── 7. store.ping() / store.keys() ─────────────────────────────────────────

describe('memoryStore ping and keys', () => {
  it('ping() returns true', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const result = await store.ping?.()
    expect(result).toBe(true)
    await store.shutdown?.()
  })

  it('keys() returns matching keys after setting entries', async () => {
    const store = memoryStore({ cleanupInterval: 0 })

    await store.set(
      'user:1',
      {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      60_000,
    )

    await store.set(
      'user:2',
      {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      60_000,
    )

    const keys = await store.keys?.()
    expect(keys).toContain('user:1')
    expect(keys).toContain('user:2')
    expect(keys).toHaveLength(2)

    await store.shutdown?.()
  })

  it('keys(prefix) filters by prefix', async () => {
    const store = memoryStore({ cleanupInterval: 0 })

    await store.set(
      'prefix:a',
      {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      60_000,
    )

    await store.set(
      'prefix:b',
      {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      60_000,
    )

    await store.set(
      'other:c',
      {
        state: {},
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      60_000,
    )

    const filtered = await store.keys?.('prefix:')
    expect(filtered).toContain('prefix:a')
    expect(filtered).toContain('prefix:b')
    expect(filtered).not.toContain('other:c')
    expect(filtered).toHaveLength(2)

    await store.shutdown?.()
  })
})

// ─── 8. RFC 7807 format ─────────────────────────────────────────────────────

describe('toErrorBody', () => {
  it('default format returns { error, message, retryAfter }', () => {
    const denied: DeniedResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfter: 30_000,
      cost: 1,
    }

    const body = toErrorBody(denied)

    expect(body).toHaveProperty('error', 'Too Many Requests')
    expect(body).toHaveProperty('message')
    expect(body).toHaveProperty('retryAfter')
    expect(typeof body.retryAfter).toBe('number')
  })

  it("{ format: 'rfc7807' } returns RFC 7807 problem details", () => {
    const denied: DeniedResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfter: 30_000,
      cost: 1,
    }

    const body = toErrorBody(denied, { format: 'rfc7807' })

    expect(body).toHaveProperty(
      'type',
      'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429',
    )
    expect(body).toHaveProperty('title', 'Too Many Requests')
    expect(body).toHaveProperty('status', 429)
    expect(body).toHaveProperty('detail')
    expect(body).toHaveProperty('retryAfter')
    expect(typeof body.retryAfter).toBe('number')
  })
})

// ─── 9. Algorithm mismatch detection ─────────────────────────────────────────

describe('algorithm mismatch detection', () => {
  it('switching algorithm on same store+key resets state (not corrupted)', async () => {
    const store = memoryStore({ cleanupInterval: 0 })

    // First limiter uses fixedWindow
    const limiter1 = createLimiter({
      algorithm: fixedWindow({ limit: 3, window: '1m' }),
      store,
    })

    await limiter1.check('shared-key')
    await limiter1.check('shared-key')
    const r1 = await limiter1.check('shared-key') // 3rd check - exhausts limit
    expect(r1.allowed).toBe(true)

    const r1denied = await limiter1.check('shared-key') // 4th → denied
    expect(r1denied.allowed).toBe(false)

    // Second limiter uses tokenBucket on SAME store & key
    const limiter2 = createLimiter({
      algorithm: tokenBucket({ capacity: 5, refillRate: 5, refillInterval: '1m' }),
      store,
    })

    // Should work fine - mismatch detected, state reset to fresh token bucket
    const r2 = await limiter2.check('shared-key')
    expect(r2.allowed).toBe(true)
    // Token bucket starts full, so remaining should reflect capacity - 1
    expect(r2.remaining).toBe(4)

    await store.shutdown?.()
  })

  it('same-algorithm reuse preserves state', async () => {
    const store = memoryStore({ cleanupInterval: 0 })

    const limiter1 = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store,
    })

    await limiter1.check('persist-key') // count 1
    await limiter1.check('persist-key') // count 2

    // Second limiter with SAME algorithm on same store
    const limiter2 = createLimiter({
      algorithm: fixedWindow({ limit: 5, window: '1m' }),
      store,
    })

    const result = await limiter2.check('persist-key') // count 3
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2) // 5 - 3 = 2

    await store.shutdown?.()
  })
})

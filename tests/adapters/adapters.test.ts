import { describe, expect, it, vi } from 'vitest'
import { rateLimit as expressRateLimit } from '../../src/adapters/express.js'
import { rateLimit as fastifyRateLimit } from '../../src/adapters/fastify.js'
import { rateLimit as honoRateLimit } from '../../src/adapters/hono.js'
import { rateLimit as createHttpRateLimiter } from '../../src/adapters/http.js'
import type {
  AllowedResult,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
} from '../../src/core/types.js'
import { toErrorBody, toHeaders } from '../../src/http/headers.js'
import { byApiKey, byComposite, byIp, byPath, byUser } from '../../src/http/key-resolvers.js'

// ─── Mock Limiter ────────────────────────────────────────────────────────────

function createMockLimiter(options?: {
  allowed?: boolean
  remaining?: number
  limit?: number
}): Limiter {
  const allowed = options?.allowed ?? true
  const remaining = options?.remaining ?? 99
  const limit = options?.limit ?? 100
  const resetAt = Date.now() + 60_000

  const result: RateLimitResult = allowed
    ? { allowed: true, limit, remaining, resetAt, cost: 1 }
    : { allowed: false, limit, remaining: 0, resetAt, retryAfter: 30_000, cost: 1 }

  return {
    check: vi.fn().mockResolvedValue(result),
    consume: vi.fn().mockResolvedValue(result),
    peek: vi.fn().mockResolvedValue({ limit, remaining, resetAt } as RateLimitInfo),
    reset: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }
}

// ─── HTTP Headers Tests ──────────────────────────────────────────────────────

describe('HTTP Headers', () => {
  const allowedResult: RateLimitResult = {
    allowed: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60_000,
    cost: 1,
  }

  const deniedResult: RateLimitResult = {
    allowed: false,
    limit: 100,
    remaining: 0,
    resetAt: Date.now() + 30_000,
    retryAfter: 30_000,
    cost: 1,
  }

  describe('toHeaders', () => {
    it('returns draft-7 headers by default', () => {
      const headers = toHeaders(allowedResult)
      expect(headers.RateLimit).toContain('limit=100')
      expect(headers.RateLimit).toContain('remaining=99')
      expect(headers.RateLimit).toContain('reset=')
    })

    it('returns legacy X- headers', () => {
      const headers = toHeaders(allowedResult, { format: 'legacy' })
      expect(headers['X-RateLimit-Limit']).toBe('100')
      expect(headers['X-RateLimit-Remaining']).toBe('99')
      expect(headers['X-RateLimit-Reset']).toBeDefined()
    })

    it('includes Retry-After on deny', () => {
      const headers = toHeaders(deniedResult)
      expect(headers['Retry-After']).toBeDefined()
      expect(Number(headers['Retry-After'])).toBeGreaterThan(0)
    })

    it('omits Retry-After on allow', () => {
      const headers = toHeaders(allowedResult)
      expect(headers['Retry-After']).toBeUndefined()
    })

    it('omits Retry-After when includeRetryAfter is false', () => {
      const headers = toHeaders(deniedResult, { includeRetryAfter: false })
      expect(headers['Retry-After']).toBeUndefined()
    })
  })

  describe('toErrorBody', () => {
    it('returns error body with retry info', () => {
      const body = toErrorBody(deniedResult)
      expect(body.error).toBe('Too Many Requests')
      expect(body.retryAfter).toBeGreaterThan(0)
      expect(body.message).toContain('Rate limit exceeded')
    })
  })
})

// ─── Key Resolvers Tests ─────────────────────────────────────────────────────

describe('Key Resolvers', () => {
  describe('byIp', () => {
    it('extracts IP from x-forwarded-for (rightmost by default)', () => {
      const resolver = byIp()
      const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }
      // trustDepth=1 (default) takes the rightmost IP (added by your reverse proxy)
      expect(resolver(req)).toBe('5.6.7.8')
    })

    it('extracts client IP from x-forwarded-for with trustDepth=2', () => {
      const resolver = byIp({ trustDepth: 2 })
      const req = { headers: { 'x-forwarded-for': 'spoofed, real-client, proxy1' } }
      expect(resolver(req)).toBe('real-client')
    })

    it('extracts IP from cf-connecting-ip', () => {
      const resolver = byIp()
      const req = { headers: { 'cf-connecting-ip': '10.0.0.1' } }
      expect(resolver(req)).toBe('10.0.0.1')
    })

    it('falls back to req.ip', () => {
      const resolver = byIp()
      const req = { headers: {}, ip: '192.168.1.1' }
      expect(resolver(req)).toBe('192.168.1.1')
    })

    it('returns unknown when no IP found', () => {
      const resolver = byIp()
      const req = { headers: {} }
      expect(resolver(req)).toBe('unknown')
    })

    it('skips proxy headers when trustProxy is false', () => {
      const resolver = byIp({ trustProxy: false })
      const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '10.0.0.1' }
      expect(resolver(req)).toBe('10.0.0.1')
    })
  })

  describe('byUser', () => {
    it('resolves user ID', () => {
      const resolver = byUser((req: { userId: string }) => req.userId)
      expect(resolver({ userId: 'user-123' })).toBe('user:user-123')
    })

    it('returns anonymous when no user', () => {
      const resolver = byUser(() => null)
      expect(resolver({})).toBe('anonymous')
    })
  })

  describe('byApiKey', () => {
    it('extracts from header', () => {
      const resolver = byApiKey()
      const req = { headers: { 'x-api-key': 'abc123' } }
      expect(resolver(req)).toBe('apikey:abc123')
    })

    it('extracts from query param', () => {
      const resolver = byApiKey()
      const req = { headers: {}, url: 'http://example.com/api?api_key=xyz' }
      expect(resolver(req)).toBe('apikey:xyz')
    })

    it('returns unknown when no key found', () => {
      const resolver = byApiKey()
      const req = { headers: {}, url: 'http://example.com/api' }
      expect(resolver(req)).toBe('apikey:unknown')
    })
  })

  describe('byComposite', () => {
    it('combines multiple resolvers', () => {
      const resolver = byComposite(
        (req: { method: string }) => req.method,
        (req: { path: string }) => req.path,
      )
      expect(resolver({ method: 'GET', path: '/api' })).toBe('GET:/api')
    })
  })

  describe('byPath', () => {
    it('extracts pathname from URL', () => {
      const resolver = byPath()
      const req = { url: 'http://example.com/api/users?page=1' }
      expect(resolver(req)).toBe('/api/users')
    })

    it('includes method when configured', () => {
      const resolver = byPath({ includeMethod: true })
      const req = { url: 'http://example.com/api/data', method: 'POST' }
      expect(resolver(req)).toBe('POST:/api/data')
    })
  })
})

// ─── Generic HTTP Adapter Tests ──────────────────────────────────────────────

describe('HTTP Adapter', () => {
  it('returns null when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = createHttpRateLimiter({ limiter })

    const req = new Request('http://localhost/api', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })

    const response = await handler(req)
    expect(response).toBeNull()
  })

  it('returns 429 when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handler = createHttpRateLimiter({ limiter })

    const req = new Request('http://localhost/api', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })

    const response = await handler(req)
    expect(response).not.toBeNull()
    expect(response?.status).toBe(429)
    const body = await response?.json()
    expect(body.error).toBe('Too Many Requests')
  })

  it('includes rate limit headers on deny', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handler = createHttpRateLimiter({ limiter })

    const req = new Request('http://localhost/api')
    const response = await handler(req)

    expect(response?.headers.get('RateLimit')).toBeDefined()
    expect(response?.headers.get('Retry-After')).toBeDefined()
  })

  it('skips when skip returns true', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handler = createHttpRateLimiter({
      limiter,
      skip: () => true,
    })

    const req = new Request('http://localhost/health')
    const response = await handler(req)
    expect(response).toBeNull()
    expect(limiter.check).not.toHaveBeenCalled()
  })

  it('uses custom key resolver', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = createHttpRateLimiter({
      limiter,
      key: (req) => new URL(req.url).pathname,
    })

    const req = new Request('http://localhost/api/users')
    await handler(req)

    expect(limiter.check).toHaveBeenCalledWith('/api/users', expect.anything())
  })

  it('uses custom onDeny handler', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const customResponse = new Response('Custom denied', { status: 403 })
    const handler = createHttpRateLimiter({
      limiter,
      onDeny: () => customResponse,
    })

    const req = new Request('http://localhost/api')
    const response = await handler(req)
    expect(response).toBe(customResponse)
  })
})

// ─── Express Adapter Tests ───────────────────────────────────────────────────

describe('Express Adapter', () => {
  function createMockExpressReq(ip = '1.2.3.4') {
    return { ip, headers: {}, method: 'GET', url: '/api' }
  }

  function createMockExpressRes() {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: null as unknown,
      status(code: number) {
        res.statusCode = code
        return res
      },
      set(h: Record<string, string>) {
        Object.assign(res.headers, h)
        return res
      },
      setHeader(name: string, value: string) {
        res.headers[name] = value
      },
      json(b: unknown) {
        res.body = b
      },
      headersSent: false,
    }
    return res
  }

  it('calls next() when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = expressRateLimit({ limiter })
    const next = vi.fn()
    const req = createMockExpressReq()
    const res = createMockExpressRes()

    middleware(req, res, next)
    await vi.waitFor(() => expect(next).toHaveBeenCalled())
  })

  it('sends 429 when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const middleware = expressRateLimit({ limiter })
    const next = vi.fn()
    const req = createMockExpressReq()
    const res = createMockExpressRes()

    middleware(req, res, next)
    await vi.waitFor(() => expect(res.statusCode).toBe(429))
    expect(next).not.toHaveBeenCalled()
    expect(res.body).toHaveProperty('error')
  })

  it('sets rate limit headers', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = expressRateLimit({ limiter })
    const next = vi.fn()
    const req = createMockExpressReq()
    const res = createMockExpressRes()

    middleware(req, res, next)
    await vi.waitFor(() => expect(next).toHaveBeenCalled())
    expect(res.headers.RateLimit).toBeDefined()
  })

  it('uses req.ip as default key', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = expressRateLimit({ limiter })
    const next = vi.fn()
    const req = createMockExpressReq('10.0.0.5')
    const res = createMockExpressRes()

    middleware(req, res, next)
    await vi.waitFor(() =>
      expect(limiter.check).toHaveBeenCalledWith('10.0.0.5', expect.anything()),
    )
  })

  it('skips when skip returns true', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const middleware = expressRateLimit({ limiter, skip: () => true })
    const next = vi.fn()
    const req = createMockExpressReq()
    const res = createMockExpressRes()

    middleware(req, res, next)
    // skip should call next immediately (synchronously)
    expect(next).toHaveBeenCalled()
    expect(limiter.check).not.toHaveBeenCalled()
  })
})

// ─── Hono Adapter Tests ──────────────────────────────────────────────────────

describe('Hono Adapter', () => {
  function createMockHonoContext(ip = '1.2.3.4') {
    const headers: Record<string, string> = { 'x-forwarded-for': ip }
    const responseHeaders: Record<string, string> = {}
    const store: Record<string, unknown> = {}
    return {
      req: {
        raw: new Request('http://localhost/api'),
        header(name: string) {
          return headers[name]
        },
        url: 'http://localhost/api',
        method: 'GET',
      },
      header(name: string, value: string) {
        responseHeaders[name] = value
      },
      json(data: unknown, status?: number) {
        return new Response(JSON.stringify(data), { status: status ?? 200 })
      },
      status(_code: number) {},
      get(key: string) {
        return store[key]
      },
      set(key: string, value: unknown) {
        store[key] = value
      },
      _responseHeaders: responseHeaders,
      _store: store,
    }
  }

  it('calls next when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = honoRateLimit({ limiter })
    const next = vi.fn().mockResolvedValue(undefined)
    const c = createMockHonoContext()

    await middleware(c as any, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 429 response when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const middleware = honoRateLimit({ limiter })
    const next = vi.fn()
    const c = createMockHonoContext()

    const response = await middleware(c as any, next)
    expect(next).not.toHaveBeenCalled()
    expect(response).toBeInstanceOf(Response)
    // Parse the response to verify status
    const parsed = JSON.parse(await (response as Response).text())
    expect(parsed.error).toBe('Too Many Requests')
  })

  it('sets rate limit headers on context', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = honoRateLimit({ limiter })
    const next = vi.fn().mockResolvedValue(undefined)
    const c = createMockHonoContext()

    await middleware(c as any, next)
    expect(c._responseHeaders.RateLimit).toBeDefined()
  })

  it('stores result in context', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = honoRateLimit({ limiter })
    const next = vi.fn().mockResolvedValue(undefined)
    const c = createMockHonoContext()

    await middleware(c as any, next)
    expect(c._store.rateLimitResult).toBeDefined()
  })
})

// ─── Fastify Adapter Tests ───────────────────────────────────────────────────

describe('Fastify Adapter', () => {
  it('returns a hook function', () => {
    const limiter = createMockLimiter({ allowed: true })
    const hook = fastifyRateLimit({ limiter })
    expect(typeof hook).toBe('function')
  })

  it('hook allows request through', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const hook = fastifyRateLimit({ limiter })

    const request = { ip: '1.2.3.4', headers: {}, method: 'GET', url: '/api' }
    const reply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      headers: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      sent: false,
    }

    await hook(request as any, reply as any)
    expect(reply.code).not.toHaveBeenCalled()
    expect(reply.headers).toHaveBeenCalled() // headers set
  })

  it('hook sends 429 when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const hook = fastifyRateLimit({ limiter })

    const request = { ip: '1.2.3.4', headers: {}, method: 'GET', url: '/api' }
    const reply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      headers: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      sent: false,
    }

    await hook(request as any, reply as any)
    expect(reply.code).toHaveBeenCalledWith(429)
    expect(reply.send).toHaveBeenCalled()
  })
})

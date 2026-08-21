import { describe, expect, it, vi } from 'vitest'
import { elysiaRateLimit } from '../../src/adapters/elysia.js'
import { h3RateLimit } from '../../src/adapters/h3.js'
import { koaRateLimit } from '../../src/adapters/koa.js'
import { withLambdaRateLimit } from '../../src/adapters/lambda.js'
import { sveltekitRateLimit } from '../../src/adapters/sveltekit.js'
import { TrpcRateLimitError, trpcRateLimit } from '../../src/adapters/trpc.js'
import { createWebSocketLimiter } from '../../src/adapters/websocket.js'
import type { Limiter, RateLimitInfo, RateLimitResult } from '../../src/core/types.js'

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

// ─── Elysia Tests ────────────────────────────────────────────────────────────

describe('Elysia Adapter', () => {
  function createMockElysiaCtx() {
    return {
      request: new Request('http://localhost/api', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }),
      set: { headers: {} as Record<string, string> },
      store: {} as Record<string, unknown>,
    }
  }

  it('returns undefined when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = elysiaRateLimit({ limiter })
    const ctx = createMockElysiaCtx()

    const result = await handler(ctx)
    expect(result).toBeUndefined()
  })

  it('returns 429 Response when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handler = elysiaRateLimit({ limiter })
    const ctx = createMockElysiaCtx()

    const result = await handler(ctx)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(429)
  })

  it('sets rate limit headers on context', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = elysiaRateLimit({ limiter })
    const ctx = createMockElysiaCtx()

    await handler(ctx)
    expect(ctx.set.headers.RateLimit).toBeDefined()
  })
})

// ─── H3 Tests ────────────────────────────────────────────────────────────────

describe('H3 Adapter', () => {
  function createMockH3Event() {
    const responseHeaders: Record<string, string> = {}
    return {
      node: {
        req: {
          headers: { 'x-forwarded-for': '10.0.0.1' },
          socket: { remoteAddress: '127.0.0.1' },
        },
        res: {
          statusCode: 200,
          setHeader(name: string, value: string) {
            responseHeaders[name] = value
          },
          end(_body?: string) {},
        },
      },
      path: '/api/test',
      method: 'GET',
      _responseHeaders: responseHeaders,
    }
  }

  it('does nothing when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = h3RateLimit({ limiter })
    const event = createMockH3Event()

    const result = await handler(event as any)
    expect(result).toBeUndefined()
    expect(event.node.res.statusCode).toBe(200)
  })

  it('sends 429 when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handler = h3RateLimit({ limiter })
    const event = createMockH3Event()

    await handler(event as any)
    expect(event.node.res.statusCode).toBe(429)
  })

  it('sets rate limit headers', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = h3RateLimit({ limiter })
    const event = createMockH3Event()

    await handler(event as any)
    expect(event._responseHeaders.RateLimit).toBeDefined()
  })
})

// ─── tRPC Tests ──────────────────────────────────────────────────────────────

describe('tRPC Adapter', () => {
  it('calls next when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = trpcRateLimit({
      limiter,
      key: (ctx: { userId: string }) => ctx.userId,
    })

    const next = vi.fn().mockResolvedValue({ data: 'ok' })
    const result = await middleware({
      ctx: { userId: 'user-1' },
      next,
      path: 'user.get',
      type: 'query',
    })

    expect(next).toHaveBeenCalled()
    expect(result).toEqual({ data: 'ok' })
  })

  it('throws TrpcRateLimitError when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const middleware = trpcRateLimit({
      limiter,
      key: (ctx: { userId: string }) => ctx.userId,
    })

    const next = vi.fn()

    await expect(
      middleware({
        ctx: { userId: 'user-1' },
        next,
        path: 'user.get',
        type: 'query',
      }),
    ).rejects.toThrow(TrpcRateLimitError)

    expect(next).not.toHaveBeenCalled()
  })

  it('uses custom error code', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const middleware = trpcRateLimit({
      limiter,
      key: (ctx: { ip: string }) => ctx.ip,
      errorCode: 'RATE_LIMITED',
    })

    try {
      await middleware({
        ctx: { ip: '1.2.3.4' },
        next: vi.fn(),
        path: 'test',
        type: 'query',
      })
    } catch (err) {
      expect((err as TrpcRateLimitError).code).toBe('RATE_LIMITED')
    }
  })
})

// ─── WebSocket Tests ─────────────────────────────────────────────────────────

describe('WebSocket Adapter', () => {
  it('allows connection when under limit', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const wsLimiter = createWebSocketLimiter({
      limiter,
      key: (info) => info.remoteAddress ?? 'unknown',
    })

    const result = await wsLimiter.checkConnection({ remoteAddress: '1.2.3.4' })
    expect(result.allowed).toBe(true)
    expect(result.action).toBe('allow')
  })

  it('denies connection when over limit', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const wsLimiter = createWebSocketLimiter({
      limiter,
      key: (info) => info.remoteAddress ?? 'unknown',
    })

    const result = await wsLimiter.checkConnection({ remoteAddress: '1.2.3.4' })
    expect(result.allowed).toBe(false)
    expect(result.action).toBe('close')
  })

  it('checks messages independently', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const wsLimiter = createWebSocketLimiter({
      limiter,
      key: (info) => info.remoteAddress ?? 'unknown',
    })

    const result = await wsLimiter.checkMessage({ remoteAddress: '1.2.3.4', message: 'hello' })
    expect(result.allowed).toBe(true)
    // Verify correct key prefix used
    expect(limiter.check).toHaveBeenCalledWith('msg:1.2.3.4', expect.anything())
  })

  it('resets both connection and message limits', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const wsLimiter = createWebSocketLimiter({
      limiter,
      key: (info) => info.remoteAddress ?? 'unknown',
    })

    await wsLimiter.reset({ remoteAddress: '1.2.3.4' })
    expect(limiter.reset).toHaveBeenCalledWith('conn:1.2.3.4')
    expect(limiter.reset).toHaveBeenCalledWith('msg:1.2.3.4')
  })
})

// ─── Koa Tests ───────────────────────────────────────────────────────────────

describe('Koa Adapter', () => {
  function createMockKoaCtx(ip = '1.2.3.4') {
    const headers: Record<string, string> = {}
    return {
      ip,
      status: 200,
      body: null as unknown,
      set(field: string | Record<string, string>, value?: string) {
        if (typeof field === 'string') {
          headers[field] = value!
        } else {
          Object.assign(headers, field)
        }
      },
      request: { ip, headers: {}, method: 'GET', url: '/api', path: '/api' },
      state: {} as Record<string, unknown>,
      _headers: headers,
    }
  }

  it('calls next when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = koaRateLimit({ limiter })
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = createMockKoaCtx()

    await middleware(ctx as any, next)
    expect(next).toHaveBeenCalled()
  })

  it('sets 429 status when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const middleware = koaRateLimit({ limiter })
    const next = vi.fn()
    const ctx = createMockKoaCtx()

    await middleware(ctx as any, next)
    expect(ctx.status).toBe(429)
    expect(next).not.toHaveBeenCalled()
  })

  it('stores result in ctx.state', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const middleware = koaRateLimit({ limiter })
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = createMockKoaCtx()

    await middleware(ctx as any, next)
    expect(ctx.state.rateLimitResult).toBeDefined()
  })
})

// ─── Lambda Tests ────────────────────────────────────────────────────────────

describe('Lambda Adapter', () => {
  function createMockEvent(ip = '1.2.3.4') {
    return {
      headers: {},
      requestContext: {
        http: { sourceIp: ip },
      },
      httpMethod: 'GET',
      path: '/api',
    }
  }

  it('passes through when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = withLambdaRateLimit({ limiter }, async () => ({
      statusCode: 200,
      headers: {},
      body: '{"ok":true}',
    }))

    const result = await handler(createMockEvent())
    expect(result.statusCode).toBe(200)
    expect(result.headers.RateLimit).toBeDefined()
  })

  it('returns 429 when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handler = withLambdaRateLimit({ limiter }, async () => ({
      statusCode: 200,
      headers: {},
      body: '{"ok":true}',
    }))

    const result = await handler(createMockEvent())
    expect(result.statusCode).toBe(429)
    expect(result.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(result.body)
    expect(body.error).toBe('Too Many Requests')
  })

  it('extracts IP from requestContext', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handler = withLambdaRateLimit({ limiter }, async () => ({
      statusCode: 200,
      headers: {},
      body: '',
    }))

    await handler(createMockEvent('10.0.0.5'))
    expect(limiter.check).toHaveBeenCalledWith('10.0.0.5', expect.anything())
  })
})

// ─── SvelteKit Tests ─────────────────────────────────────────────────────────

describe('SvelteKit Adapter', () => {
  function createMockSvelteKitEvent(path = '/api/data') {
    return {
      request: new Request(`http://localhost${path}`),
      url: new URL(`http://localhost${path}`),
      getClientAddress: () => '192.168.1.1',
      locals: {} as Record<string, unknown>,
    }
  }

  it('resolves response when allowed', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handle = sveltekitRateLimit({ limiter })
    const event = createMockSvelteKitEvent()
    const resolve = vi.fn().mockResolvedValue(new Response('OK'))

    const response = await handle({ event, resolve })
    expect(resolve).toHaveBeenCalled()
    expect(response.headers.get('RateLimit')).toBeDefined()
  })

  it('returns 429 when denied', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handle = sveltekitRateLimit({ limiter })
    const event = createMockSvelteKitEvent()
    const resolve = vi.fn()

    const response = await handle({ event, resolve })
    expect(resolve).not.toHaveBeenCalled()
    expect(response.status).toBe(429)
  })

  it('respects path filtering', async () => {
    const limiter = createMockLimiter({ allowed: false })
    const handle = sveltekitRateLimit({ limiter, paths: ['/api/*'] })
    const event = createMockSvelteKitEvent('/about')
    const resolve = vi.fn().mockResolvedValue(new Response('OK'))

    await handle({ event, resolve })
    expect(resolve).toHaveBeenCalled() // Not rate limited - path doesn't match
    expect(limiter.check).not.toHaveBeenCalled()
  })

  it('stores result in locals', async () => {
    const limiter = createMockLimiter({ allowed: true })
    const handle = sveltekitRateLimit({ limiter })
    const event = createMockSvelteKitEvent()
    const resolve = vi.fn().mockResolvedValue(new Response('OK'))

    await handle({ event, resolve })
    expect(event.locals.rateLimitResult).toBeDefined()
  })
})

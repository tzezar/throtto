import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Next.js Types ───────────────────────────────────────────────────────────
// Minimal interfaces compatible with Next.js

export interface NextRequest {
  ip?: string | undefined
  headers: Headers
  nextUrl: { pathname: string }
  method: string
  url: string
}

export interface NextResponse {
  headers: Headers
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface NextAdapterConfig {
  /** The rate limiter instance */
  limiter: Limiter
  /** Key resolver. Default: request IP */
  key?: ((req: NextRequest) => string) | undefined
  /** Cost per request. Default: 1 */
  cost?: number | ((req: NextRequest) => number) | undefined
  /** Whether to set rate limit headers. Default: true */
  headers?: boolean | undefined
  /** Header format. Default: 'draft-7' */
  headerFormat?: HeaderFormat | undefined
  /** Path patterns to rate limit. If not set, all paths are limited. */
  paths?: string[] | undefined
  /** Paths to exclude from rate limiting */
  excludePaths?: string[] | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(input: NextAdapterConfig | string): NextAdapterConfig {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }
  return input
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates a Next.js rate limit handler.
 *
 * Overload 1 — check-only (for middleware.ts):
 * ```ts
 * import { rateLimit } from 'throtto/adapters/nextjs'
 *
 * const check = rateLimit('100/minute')
 * export async function middleware(request: NextRequest) {
 *   const response = await check(request)
 *   if (response) return response // 429
 *   return NextResponse.next()
 * }
 * ```
 *
 * Overload 2 — wraps a handler (for App Router API routes):
 * ```ts
 * export const GET = rateLimit({ limiter }, async (request) => {
 *   return Response.json({ data: '...' })
 * })
 * ```
 */
export function rateLimit(
  config: NextAdapterConfig | string,
): (req: NextRequest) => Promise<Response | null>
export function rateLimit(
  config: NextAdapterConfig | string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response>
export function rateLimit(
  config: NextAdapterConfig | string,
  handler?: (req: Request) => Promise<Response> | Response,
): ((req: NextRequest) => Promise<Response | null>) | ((req: Request) => Promise<Response>) {
  const resolved = resolveConfig(config)

  if (handler) {
    return createHandlerWrapper(resolved, handler)
  }
  return createCheckOnly(resolved)
}

// ─── Check-Only Form ─────────────────────────────────────────────────────────

function createCheckOnly(
  config: NextAdapterConfig,
): (req: NextRequest) => Promise<Response | null> {
  const {
    limiter,
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    paths,
    excludePaths,
    skipPaths,
    skipMethods,
  } = config

  return async (req: NextRequest): Promise<Response | null> => {
    const pathname = req.nextUrl.pathname

    // Check path matching
    if (paths && !matchesAnyPattern(pathname, paths)) return null
    if (excludePaths && matchesAnyPattern(pathname, excludePaths)) return null

    if (skipPaths || skipMethods) {
      if (shouldSkip(pathname, req.method, { skipPaths, skipMethods })) return null
    }

    // Resolve key
    const resolvedKey = keyResolver ? keyResolver(req) : extractIp(req)
    const resolvedCost = typeof cost === 'function' ? cost(req) : cost

    // Check rate limit
    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (result.allowed) {
      return null
    }

    // Denied - return 429 response
    const rateLimitHeaders = includeHeaders ? toHeaders(result, { format: headerFormat }) : {}

    const body = toErrorBody(result)
    const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
    for (const [name, value] of Object.entries(rateLimitHeaders)) {
      responseHeaders.set(name, value)
    }

    return new Response(JSON.stringify(body), {
      status: 429,
      headers: responseHeaders,
    })
  }
}

// ─── Handler Wrapper Form ────────────────────────────────────────────────────

function createHandlerWrapper(
  config: NextAdapterConfig,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  const {
    limiter,
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skipPaths,
    skipMethods,
  } = config

  return async (req: Request): Promise<Response> => {
    if (skipPaths || skipMethods) {
      const url = new URL(req.url)
      if (shouldSkip(url.pathname, req.method, { skipPaths, skipMethods })) {
        return handler(req)
      }
    }

    const resolvedKey = keyResolver
      ? keyResolver(req as unknown as NextRequest)
      : extractIpFromHeaders(req.headers)

    const resolvedCost = typeof cost === 'function' ? cost(req as unknown as NextRequest) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (!result.allowed) {
      const rateLimitHeaders = includeHeaders ? toHeaders(result, { format: headerFormat }) : {}
      const body = toErrorBody(result)
      const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        responseHeaders.set(name, value)
      }
      return new Response(JSON.stringify(body), { status: 429, headers: responseHeaders })
    }

    // Allowed - call handler and add rate limit headers to response
    const response = await handler(req)

    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        response.headers.set(name, value)
      }
    }

    return response
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractIp(req: NextRequest): string {
  if (req.ip) return req.ip
  return extractIpFromHeaders(req.headers)
}

function extractIpFromHeaders(headers: Headers): string {
  const cfIp = headers.get('cf-connecting-ip')
  if (cfIp) return cfIp

  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    const last = parts[parts.length - 1]?.trim()
    if (last) return last
  }

  return 'unknown'
}

function matchesAnyPattern(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(pathname, pattern))
}

function matchPattern(pathname: string, pattern: string): boolean {
  // Simple glob matching: supports * and **
  if (pattern === '*' || pattern === '**') return true

  // Convert glob to regex
  const regexStr = pattern
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE_STAR___/g, '.*')

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(pathname)
}

import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import type { KeyResolver } from '../http/key-resolvers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Config ──────────────────────────────────────────────────────────────────

export interface HttpAdapterConfig {
  /** The rate limiter instance */
  limiter: Limiter
  /** Key resolver. Default: uses 'cf-connecting-ip' or 'x-forwarded-for' header */
  key?: KeyResolver<Request> | undefined
  /** Cost per request. Default: 1 */
  cost?: number | ((req: Request) => number) | undefined
  /** Whether to set rate limit headers. Default: true */
  headers?: boolean | undefined
  /** Header format. Default: 'draft-7' */
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  /** Skip rate limiting for matching requests */
  skip?: ((req: Request) => boolean) | undefined
  /** Custom deny handler. Return a Response to override default 429. */
  onDeny?: ((req: Request, result: RateLimitResult) => Response | undefined | null) | undefined
}

// ─── Result Type ─────────────────────────────────────────────────────────────

export interface HttpRateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Rate limit result details */
  result: RateLimitResult
  /** Headers to set on the response */
  headers: Record<string, string>
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(input: HttpAdapterConfig | string): HttpAdapterConfig {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }
  return input
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Creates a generic HTTP rate limit handler using the Fetch API.
 * Works with any runtime that supports Request/Response (Deno, Bun, Cloudflare Workers, etc.)
 *
 * Returns null if allowed (proceed with your handler), or a 429 Response if denied.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/http'
 *
 * const check = rateLimit('100/minute')
 * // In your handler:
 * const denied = await check(request)
 * if (denied) return denied
 * ```
 */
export function rateLimit(
  config: HttpAdapterConfig | string,
): (req: Request) => Promise<Response | null> {
  const resolved = resolveConfig(config)

  const {
    limiter,
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skip,
    skipPaths,
    skipMethods,
    onDeny,
  } = resolved

  return async (req: Request): Promise<Response | null> => {
    // Skip check
    if (skipPaths || skipMethods) {
      const url = new URL(req.url)
      if (shouldSkip(url.pathname, req.method, { skipPaths, skipMethods })) return null
    }

    if (skip?.(req)) return null

    // Resolve key
    const resolvedKey = keyResolver ? keyResolver(req) : extractIpFromRequest(req)

    // Resolve cost
    const resolvedCost = typeof cost === 'function' ? cost(req) : cost

    // Check rate limit
    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    // Build headers
    const rateLimitHeaders = includeHeaders ? toHeaders(result, { format: headerFormat }) : {}

    if (result.allowed) {
      return null // Proceed - caller should add headers to their response
    }

    // Denied
    if (onDeny) {
      const customResponse = onDeny(req, result)
      if (customResponse) return customResponse
    }

    const body = toErrorBody(result)
    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      ...rateLimitHeaders,
    })

    return new Response(JSON.stringify(body), {
      status: 429,
      headers: responseHeaders,
    })
  }
}

// ─── Lower-Level Checker ─────────────────────────────────────────────────────

/**
 * Lower-level check that returns the result + headers without creating a Response.
 * Useful when you want to handle the response yourself.
 */
export function createHttpChecker(
  config: HttpAdapterConfig,
): (req: Request) => Promise<HttpRateLimitResult> {
  const {
    limiter,
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skip,
    skipPaths,
    skipMethods,
  } = config

  return async (req: Request): Promise<HttpRateLimitResult> => {
    if (skipPaths || skipMethods) {
      const url = new URL(req.url)
      if (shouldSkip(url.pathname, req.method, { skipPaths, skipMethods })) {
        const passResult: RateLimitResult = {
          allowed: true,
          limit: 0,
          remaining: 0,
          resetAt: 0,
          cost: 0,
        }
        return { allowed: true, result: passResult, headers: {} }
      }
    }

    if (skip?.(req)) {
      const passResult: RateLimitResult = {
        allowed: true,
        limit: 0,
        remaining: 0,
        resetAt: 0,
        cost: 0,
      }
      return { allowed: true, result: passResult, headers: {} }
    }

    const resolvedKey = keyResolver ? keyResolver(req) : extractIpFromRequest(req)

    const resolvedCost = typeof cost === 'function' ? cost(req) : cost
    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    const headers = includeHeaders ? toHeaders(result, { format: headerFormat }) : {}

    return { allowed: result.allowed, result, headers }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractIpFromRequest(req: Request): string {
  const headers = req.headers
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

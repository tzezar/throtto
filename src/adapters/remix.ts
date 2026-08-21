import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Remix Types ─────────────────────────────────────────────────────────────

export interface RemixArgs {
  request: Request
  params: Record<string, string | undefined>
  context?: unknown
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RemixAdapterConfig {
  limiter: Limiter
  key?: ((args: RemixArgs) => string) | undefined
  cost?: number | ((args: RemixArgs) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((args: RemixArgs) => boolean) | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(input: RemixAdapterConfig | string): RemixAdapterConfig {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }
  return input
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates a Remix rate limit handler.
 *
 * Overload 1 — check-only (returns `Response | null`):
 * ```ts
 * import { rateLimit } from 'throtto/adapters/remix'
 *
 * const check = rateLimit('100/minute')
 * export async function loader(args) {
 *   const denied = await check(args)
 *   if (denied) return denied
 *   return json({ data: '...' })
 * }
 * ```
 *
 * Overload 2 — wraps a handler:
 * ```ts
 * export const loader = rateLimit({ limiter }, async (args) => {
 *   return json({ data: '...' })
 * })
 * ```
 */
export function rateLimit(
  config: RemixAdapterConfig | string,
): (args: RemixArgs) => Promise<Response | null>
export function rateLimit(
  config: RemixAdapterConfig | string,
  handler: (args: RemixArgs) => Promise<Response> | Response,
): (args: RemixArgs) => Promise<Response>
export function rateLimit(
  config: RemixAdapterConfig | string,
  handler?: (args: RemixArgs) => Promise<Response> | Response,
): ((args: RemixArgs) => Promise<Response | null>) | ((args: RemixArgs) => Promise<Response>) {
  const resolved = resolveConfig(config)

  if (handler) {
    return createHandlerWrapper(resolved, handler)
  }
  return createCheckOnly(resolved)
}

// ─── Check-Only Form ─────────────────────────────────────────────────────────

function createCheckOnly(
  config: RemixAdapterConfig,
): (args: RemixArgs) => Promise<Response | null> {
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

  return async (args: RemixArgs): Promise<Response | null> => {
    if (skipPaths || skipMethods) {
      const url = new URL(args.request.url)
      if (shouldSkip(url.pathname, args.request.method, { skipPaths, skipMethods })) return null
    }

    if (skip?.(args)) return null

    const resolvedKey = keyResolver ? keyResolver(args) : extractIp(args.request)
    const resolvedCost = typeof cost === 'function' ? cost(args) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (result.allowed) return null

    const body = toErrorBody(result)
    const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        responseHeaders.set(name, value)
      }
    }
    return new Response(JSON.stringify(body), { status: 429, headers: responseHeaders })
  }
}

// ─── Handler Wrapper Form ────────────────────────────────────────────────────

function createHandlerWrapper(
  config: RemixAdapterConfig,
  handler: (args: RemixArgs) => Promise<Response> | Response,
): (args: RemixArgs) => Promise<Response> {
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

  return async (args: RemixArgs): Promise<Response> => {
    if (skipPaths || skipMethods) {
      const url = new URL(args.request.url)
      if (shouldSkip(url.pathname, args.request.method, { skipPaths, skipMethods })) {
        return handler(args)
      }
    }

    if (skip?.(args)) {
      return handler(args)
    }

    const resolvedKey = keyResolver ? keyResolver(args) : extractIp(args.request)
    const resolvedCost = typeof cost === 'function' ? cost(args) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (!result.allowed) {
      const body = toErrorBody(result)
      const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
      if (includeHeaders) {
        const rateLimitHeaders = toHeaders(result, { format: headerFormat })
        for (const [name, value] of Object.entries(rateLimitHeaders)) {
          responseHeaders.set(name, value)
        }
      }
      return new Response(JSON.stringify(body), { status: 429, headers: responseHeaders })
    }

    const response = await handler(args)

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

function extractIp(req: Request): string {
  const cfIp = req.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    return parts[parts.length - 1]?.trim() ?? 'unknown'
  }
  return 'unknown'
}

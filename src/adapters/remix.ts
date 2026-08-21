import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
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
  /** Pre-created limiter instance. If not provided, one is created from limit/window. */
  limiter?: Limiter | undefined
  /** Shorthand: request limit. Required if limiter is not provided. */
  limit?: number | undefined
  /** Shorthand: window duration. Required if limit is provided. */
  window?: Duration | undefined
  /** Algorithm when creating inline limiter. Default: 'sliding-window-counter' */
  algorithm?:
    | 'sliding-window-counter'
    | 'fixed-window'
    | 'token-bucket'
    | 'sliding-window-log'
    | 'leaky-bucket'
    | 'gcra'
    | 'concurrency'
    | undefined
  /** Store when creating inline limiter. Default: memory */
  store?: Store | undefined
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

function resolveConfig(
  input: RemixAdapterConfig | string,
): RemixAdapterConfig & { limiter: Limiter } {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }

  const limiter =
    input.limiter ??
    (() => {
      if (input.limit === undefined) {
        throw new ConfigError('Either "limiter" or "limit" (with "window") must be provided.')
      }
      if (input.window === undefined) {
        throw new ConfigError(
          "'window' is required when using inline config. Example: { limit: 100, window: '1m' }",
        )
      }
      return createInternalLimiter({
        limit: input.limit,
        window: input.window,
        algorithm: input.algorithm,
        store: input.store,
      })
    })()

  return { ...input, limiter }
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
  config: RemixAdapterConfig & { limiter: Limiter },
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
  config: RemixAdapterConfig & { limiter: Limiter },
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

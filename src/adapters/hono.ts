import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Hono Types ──────────────────────────────────────────────────────────────
// Minimal types compatible with Hono's Context

export interface HonoContext {
  req: {
    raw: Request
    header(name: string): string | undefined
    url: string
    method: string
  }
  header(name: string, value: string): void
  json(data: unknown, status?: number): Response
  status(code: number): void
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export type HonoNext = () => Promise<void>

// ─── Config ──────────────────────────────────────────────────────────────────

export interface HonoAdapterConfig {
  /** Pre-created limiter instance */
  limiter?: Limiter | undefined
  /** Shorthand: limit (creates limiter internally). Ignored if limiter is provided. */
  limit?: number | undefined
  /** Shorthand: window duration. Required if limit is provided. */
  window?: Duration | undefined
  /** Shorthand: algorithm. Default: 'sliding-window-counter' */
  algorithm?:
    | 'sliding-window-counter'
    | 'fixed-window'
    | 'token-bucket'
    | 'sliding-window-log'
    | 'leaky-bucket'
    | 'gcra'
    | 'concurrency'
    | undefined
  /** Store to use when creating inline limiter. Default: memory */
  store?: Store | undefined
  /** Key resolver. Default: IP from headers */
  key?: ((c: HonoContext) => string) | undefined
  /** Cost per request. Default: 1 */
  cost?: number | ((c: HonoContext) => number) | undefined
  /** Whether to set rate limit headers. Default: true */
  headers?: boolean | undefined
  /** Header format. Default: 'draft-7' */
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  /** Skip rate limiting for matching requests */
  skip?: ((c: HonoContext) => boolean) | undefined
  /** Custom deny handler */
  onDeny?: ((c: HonoContext, result: RateLimitResult) => Response | undefined | null) | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(input: HonoAdapterConfig | string): HonoAdapterConfig {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }
  return input
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates a Hono middleware for rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/hono'
 *
 * app.use(rateLimit('100/minute'))
 * app.use(rateLimit({ limiter, key: (c) => c.req.header('x-api-key') ?? 'anon' }))
 * ```
 */
export function rateLimit(
  config: HonoAdapterConfig | string,
): (c: HonoContext, next: HonoNext) => Promise<Response | undefined> {
  const resolved = resolveConfig(config)

  if (!resolved.limiter && resolved.limit === undefined) {
    throw new ConfigError('Either "limiter" or "limit" (with "window") must be provided.')
  }

  if (!resolved.limiter && resolved.limit !== undefined && resolved.window === undefined) {
    throw new ConfigError(
      "'window' is required when using inline rate limit config. Example: { limit: 100, window: '1m' }",
    )
  }

  const resolvedLimiter =
    resolved.limiter ??
    createInternalLimiter({
      limit: resolved.limit!,
      window: resolved.window!,
      algorithm: resolved.algorithm,
      store: resolved.store,
    })

  const {
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skip,
    skipPaths,
    skipMethods,
    onDeny,
  } = resolved

  return async (c: HonoContext, next: HonoNext): Promise<Response | undefined> => {
    if (skipPaths || skipMethods) {
      const url = new URL(c.req.url)
      if (shouldSkip(url.pathname, c.req.method, { skipPaths, skipMethods })) {
        await next()
        return
      }
    }

    if (skip?.(c)) {
      await next()
      return
    }

    const resolvedKey = keyResolver ? keyResolver(c) : extractIp(c)
    const resolvedCost = typeof cost === 'function' ? cost(c) : cost

    const result = await resolvedLimiter.check(resolvedKey, { cost: resolvedCost })

    // Set headers
    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        c.header(name, value)
      }
    }

    // Store result in context for downstream handlers
    c.set('rateLimitResult', result)

    if (result.allowed) {
      await next()
      return
    }

    // Denied
    if (onDeny) {
      const customResponse = onDeny(c, result)
      if (customResponse) return customResponse
    }

    const body = toErrorBody(result)
    return c.json(body, 429)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractIp(c: HonoContext): string {
  const cfIp = c.req.header('cf-connecting-ip')
  if (cfIp) return cfIp

  const realIp = c.req.header('x-real-ip')
  if (realIp) return realIp

  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    const last = parts[parts.length - 1]?.trim()
    if (last) return last
  }

  return 'unknown'
}

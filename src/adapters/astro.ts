import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Astro Types ─────────────────────────────────────────────────────────────

export interface AstroContext {
  request: Request
  url: URL
  clientAddress: string
  locals: Record<string, unknown>
}

export type AstroNext = () => Promise<Response>

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AstroAdapterConfig {
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
  key?: ((ctx: AstroContext) => string) | undefined
  cost?: number | ((ctx: AstroContext) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((ctx: AstroContext) => boolean) | undefined
  onDeny?: ((ctx: AstroContext, result: RateLimitResult) => Response | undefined | null) | undefined
  paths?: string[] | undefined
  excludePaths?: string[] | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(
  input: AstroAdapterConfig | string,
): AstroAdapterConfig & { limiter: Limiter } {
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
 * Creates an Astro middleware for rate limiting.
 *
 * Usage in src/middleware.ts:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/astro'
 *
 * export const onRequest = rateLimit('100/minute')
 * // Or with full config:
 * export const onRequest = rateLimit({
 *   limiter: myLimiter,
 *   paths: ['/api/*'],
 * })
 * ```
 */
export function rateLimit(
  config: AstroAdapterConfig | string,
): (ctx: AstroContext, next: AstroNext) => Promise<Response> {
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
    paths,
    excludePaths,
  } = resolved

  return async (ctx: AstroContext, next: AstroNext): Promise<Response> => {
    const pathname = ctx.url.pathname

    if (paths && !matchesAny(pathname, paths)) return next()
    if (excludePaths && matchesAny(pathname, excludePaths)) return next()

    if (skipPaths || skipMethods) {
      if (shouldSkip(pathname, ctx.request.method, { skipPaths, skipMethods })) return next()
    }

    if (skip?.(ctx)) return next()

    const resolvedKey = keyResolver ? keyResolver(ctx) : ctx.clientAddress
    const resolvedCost = typeof cost === 'function' ? cost(ctx) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    ctx.locals.rateLimitResult = result

    if (result.allowed) {
      const response = await next()
      if (includeHeaders) {
        const rateLimitHeaders = toHeaders(result, { format: headerFormat })
        for (const [name, value] of Object.entries(rateLimitHeaders)) {
          response.headers.set(name, value)
        }
      }
      return response
    }

    if (onDeny) {
      const custom = onDeny(ctx, result)
      if (custom) return custom
    }

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

function matchesAny(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p === '*') return true
    const regex = p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
    return new RegExp(`^${regex}$`).test(pathname)
  })
}

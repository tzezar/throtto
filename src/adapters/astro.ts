import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

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
  limiter: Limiter
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

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates an Astro middleware for rate limiting.
 *
 * Usage in src/middleware.ts:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { astroRateLimit } from 'throtto/adapters/astro'
 *
 * export const onRequest = astroRateLimit({
 *   limiter: rateLimit('100/minute'),
 *   paths: ['/api/*'],
 * })
 * ```
 */
export function astroRateLimit(
  config: AstroAdapterConfig,
): (ctx: AstroContext, next: AstroNext) => Promise<Response> {
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
  } = config

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

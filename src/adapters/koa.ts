import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

// ─── Koa Types ───────────────────────────────────────────────────────────────

export interface KoaContext {
  ip: string
  status: number
  body: unknown
  set(field: string, value: string): void
  set(fields: Record<string, string>): void
  request: {
    ip: string
    headers: Record<string, string | string[] | undefined>
    method: string
    url: string
    path: string
  }
  state: Record<string, unknown>
}

export type KoaNext = () => Promise<void>

// ─── Config ──────────────────────────────────────────────────────────────────

export interface KoaAdapterConfig {
  limiter: Limiter
  key?: ((ctx: KoaContext) => string) | undefined
  cost?: number | ((ctx: KoaContext) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((ctx: KoaContext) => boolean) | undefined
  onDeny?: ((ctx: KoaContext, result: RateLimitResult) => void) | undefined
  statusCode?: number | undefined
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates a Koa middleware for rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { koaRateLimit } from 'throtto/adapters/koa'
 *
 * const limiter = rateLimit('100/minute')
 * app.use(koaRateLimit({ limiter }))
 * ```
 */
export function koaRateLimit(
  config: KoaAdapterConfig,
): (ctx: KoaContext, next: KoaNext) => Promise<void> {
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
    statusCode = 429,
  } = config

  return async (ctx: KoaContext, next: KoaNext): Promise<void> => {
    if (skipPaths || skipMethods) {
      if (shouldSkip(ctx.request.path, ctx.request.method, { skipPaths, skipMethods })) {
        await next()
        return
      }
    }

    if (skip?.(ctx)) {
      await next()
      return
    }

    const resolvedKey = keyResolver ? keyResolver(ctx) : ctx.ip
    const resolvedCost = typeof cost === 'function' ? cost(ctx) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      ctx.set(rateLimitHeaders)
    }

    // Store result in state for downstream middleware
    ctx.state.rateLimitResult = result

    if (result.allowed) {
      await next()
      return
    }

    if (onDeny) {
      onDeny(ctx, result)
      return
    }

    ctx.status = statusCode
    ctx.body = toErrorBody(result)
  }
}

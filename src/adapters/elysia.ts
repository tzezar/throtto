import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

// ─── Elysia Types ────────────────────────────────────────────────────────────

export interface ElysiaContext {
  request: Request
  set: {
    status?: number | undefined
    headers: Record<string, string>
  }
  store: Record<string, unknown>
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ElysiaAdapterConfig {
  limiter: Limiter
  key?: ((ctx: ElysiaContext) => string) | undefined
  cost?: number | ((ctx: ElysiaContext) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((ctx: ElysiaContext) => boolean) | undefined
  onDeny?:
    | ((ctx: ElysiaContext, result: RateLimitResult) => Response | undefined | null)
    | undefined
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Creates an Elysia beforeHandle hook for rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { elysiaRateLimit } from 'throtto/adapters/elysia'
 *
 * const app = new Elysia()
 *   .onBeforeHandle(elysiaRateLimit({ limiter: rateLimit('100/minute') }))
 * ```
 */
export function elysiaRateLimit(
  config: ElysiaAdapterConfig,
): (ctx: ElysiaContext) => Promise<Response | undefined> {
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
  } = config

  return async (ctx: ElysiaContext): Promise<Response | undefined> => {
    if (skipPaths || skipMethods) {
      const url = new URL(ctx.request.url)
      if (shouldSkip(url.pathname, ctx.request.method, { skipPaths, skipMethods })) return
    }

    if (skip?.(ctx)) return

    const resolvedKey = keyResolver ? keyResolver(ctx) : extractIp(ctx.request)
    const resolvedCost = typeof cost === 'function' ? cost(ctx) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      Object.assign(ctx.set.headers, rateLimitHeaders)
    }

    if (result.allowed) return

    if (onDeny) {
      const custom = onDeny(ctx, result)
      if (custom) return custom
    }

    ctx.set.status = 429
    const body = toErrorBody(result)
    return new Response(JSON.stringify(body), {
      status: 429,
      headers: { 'Content-Type': 'application/json', ...ctx.set.headers },
    })
  }
}

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

import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

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

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(
  input: ElysiaAdapterConfig | string,
): ElysiaAdapterConfig & { limiter: Limiter } {
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

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Creates an Elysia beforeHandle hook for rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/elysia'
 *
 * const app = new Elysia()
 *   .onBeforeHandle(rateLimit('100/minute'))
 * ```
 */
export function rateLimit(
  config: ElysiaAdapterConfig | string,
): (ctx: ElysiaContext) => Promise<Response | undefined> {
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

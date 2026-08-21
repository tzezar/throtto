import type { Limiter, RateLimitResult } from '../core/types.js'

// ─── tRPC Types ──────────────────────────────────────────────────────────────

export interface TrpcMiddlewareOptions<TContext> {
  ctx: TContext
  next: () => Promise<unknown>
  path: string
  type: string
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface TrpcAdapterConfig<TContext = unknown> {
  limiter: Limiter
  /** Extract rate limit key from tRPC context */
  key: (ctx: TContext) => string
  /** Cost per procedure call. Default: 1 */
  cost?: number | ((ctx: TContext, path: string) => number) | undefined
  /** Paths to skip rate limiting for. Note: Not applicable for tRPC - use the `skip` callback for procedure-level filtering. */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Note: Not applicable for tRPC - use the `skip` callback instead. */
  skipMethods?: string[] | undefined
  /** Skip rate limiting for certain procedures */
  skip?: ((ctx: TContext, path: string) => boolean) | undefined
  /** Custom error code. Default: 'TOO_MANY_REQUESTS' */
  errorCode?: string | undefined
  /** Custom error message */
  errorMessage?: string | ((result: RateLimitResult) => string) | undefined
}

// ─── tRPC Error ──────────────────────────────────────────────────────────────

export class TrpcRateLimitError extends Error {
  code: string
  result: RateLimitResult

  constructor(message: string, code: string, result: RateLimitResult) {
    super(message)
    this.name = 'TRPCError'
    this.code = code
    this.result = result
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates a tRPC middleware for rate limiting.
 *
 * Note: String presets are NOT supported for tRPC because `key` is required.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/trpc'
 * import { rateLimit as createLimiter } from 'throtto'
 *
 * const rateLimitMiddleware = rateLimit({
 *   limiter: createLimiter('100/minute'),
 *   key: (ctx) => ctx.userId ?? ctx.ip,
 * })
 *
 * const protectedProcedure = t.procedure.use(rateLimitMiddleware)
 * ```
 */
export function rateLimit<TContext = unknown>(
  config: TrpcAdapterConfig<TContext>,
): (opts: TrpcMiddlewareOptions<TContext>) => Promise<unknown> {
  const {
    limiter,
    key: keyResolver,
    cost,
    skip,
    errorCode = 'TOO_MANY_REQUESTS',
    errorMessage,
  } = config

  return async (opts: TrpcMiddlewareOptions<TContext>): Promise<unknown> => {
    const { ctx, next, path } = opts

    if (skip?.(ctx, path)) {
      return next()
    }

    const resolvedKey = keyResolver(ctx)
    const resolvedCost = typeof cost === 'function' ? cost(ctx, path) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (result.allowed) {
      return next()
    }

    const message = errorMessage
      ? typeof errorMessage === 'function'
        ? errorMessage(result)
        : errorMessage
      : 'Rate limit exceeded. Try again later.'

    throw new TrpcRateLimitError(message, errorCode, result)
  }
}

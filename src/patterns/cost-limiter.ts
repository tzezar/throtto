import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export interface CostMapping<TContext = string> {
  /** Resolve cost for a given context */
  resolveCost: (ctx: TContext) => number
}

/**
 * Wrap a limiter with automatic cost resolution.
 *
 * Maps different operations to different costs without
 * needing to specify cost on every check() call.
 */
export function withCostMapping<TContext = string>(
  limiter: Limiter<TContext>,
  mapping: CostMapping<TContext>,
): Limiter<TContext> {
  return {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const cost = options?.cost ?? mapping.resolveCost(ctx)
      return limiter.check(ctx, { ...options, cost })
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const cost = options?.cost ?? mapping.resolveCost(ctx)
      return limiter.consume(ctx, { ...options, cost })
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      return limiter.peek(ctx)
    },

    async reset(ctx: TContext): Promise<void> {
      return limiter.reset(ctx)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      return limiter.shutdown(options)
    },
  }
}

import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export interface BatchItem<TContext> {
  ctx: TContext
  cost?: number | undefined
}

/**
 * Wrap a limiter with batch check support.
 *
 * checkMany() processes multiple rate limit checks efficiently.
 * For memory stores, this is sequential. For Redis/SQL stores,
 * implementations can pipeline for better performance.
 */
export function withBatch<TContext = string>(): (
  limiter: Limiter<TContext>,
) => Limiter<TContext> & { checkMany(items: BatchItem<TContext>[]): Promise<RateLimitResult[]> }
export function withBatch<TContext = string>(
  limiter: Limiter<TContext>,
): Limiter<TContext> & { checkMany(items: BatchItem<TContext>[]): Promise<RateLimitResult[]> }
export function withBatch<TContext = string>(
  maybeLimiter?: Limiter<TContext> | undefined,
):
  | (Limiter<TContext> & { checkMany(items: BatchItem<TContext>[]): Promise<RateLimitResult[]> })
  | ((limiter: Limiter<TContext>) => Limiter<TContext> & {
      checkMany(items: BatchItem<TContext>[]): Promise<RateLimitResult[]>
    }) {
  if (!maybeLimiter || !('check' in maybeLimiter)) {
    return (limiter: Limiter<TContext>) => withBatchImpl(limiter)
  }
  return withBatchImpl(maybeLimiter)
}

function withBatchImpl<TContext = string>(
  limiter: Limiter<TContext>,
): Limiter<TContext> & { checkMany(items: BatchItem<TContext>[]): Promise<RateLimitResult[]> } {
  return {
    ...limiter,

    async checkMany(items: BatchItem<TContext>[]): Promise<RateLimitResult[]> {
      const results: RateLimitResult[] = []
      for (const item of items) {
        const result = await limiter.check(item.ctx, { cost: item.cost })
        results.push(result)
      }
      return results
    },

    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      return limiter.check(ctx, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      return limiter.consume(ctx, options)
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

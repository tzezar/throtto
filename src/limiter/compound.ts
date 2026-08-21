import { ConfigError } from '../core/errors.js'
import type {
  AllowedResult,
  CheckOptions,
  DeniedResult,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export interface CompoundLayer<TContext = string> {
  name: string
  limiter: Limiter<TContext>
}

/**
 * Create a compound limiter that checks multiple layers.
 * A request is only allowed if ALL layers allow it.
 * Denied by the first layer that rejects.
 *
 * @example
 * ```ts
 * const limiter = createCompoundLimiter([
 *   { name: 'per-second', limiter: rateLimit('10/second') },
 *   { name: 'per-minute', limiter: rateLimit('100/minute') },
 *   { name: 'per-hour', limiter: rateLimit('1000/hour') },
 * ])
 * ```
 */
export function createCompoundLimiter<TContext = string>(
  layers: CompoundLayer<TContext>[],
): Limiter<TContext> & { layers: readonly CompoundLayer<TContext>[] } {
  if (!layers || layers.length === 0) {
    throw new ConfigError('createCompoundLimiter requires at least one layer.')
  }

  return {
    layers,

    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const results: RateLimitResult[] = []

      for (const layer of layers) {
        const result = await layer.limiter.check(ctx, options)
        results.push(result)

        if (!result.allowed) {
          return result
        }
      }

      // All passed - return the most restrictive allowed result
      const mostRestrictive = results.reduce(
        (min, r) => {
          if (!r.allowed) return min
          if (!min) return r as AllowedResult
          return r.remaining < min.remaining ? (r as AllowedResult) : min
        },
        null as AllowedResult | null,
      )

      return mostRestrictive ?? results[0]!
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const result = await this.check(ctx, options)
      if (result.allowed) return result

      const { RateLimitExceededError } = await import('../core/errors.js')
      throw new RateLimitExceededError(
        'Rate limit exceeded',
        result.retryAfter,
        result.limit,
        result.resetAt,
      )
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      let mostRestrictive: RateLimitInfo | null = null

      for (const layer of layers) {
        const info = await layer.limiter.peek(ctx)
        if (info && (!mostRestrictive || info.remaining < mostRestrictive.remaining)) {
          mostRestrictive = info
        }
      }

      return mostRestrictive
    },

    async reset(ctx: TContext): Promise<void> {
      await Promise.all(layers.map((l) => l.limiter.reset(ctx)))
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      await Promise.all(layers.map((l) => l.limiter.shutdown(options)))
    },
  }
}

import { isLimiter } from '../core/guards.js'
import { createAllowedResult, createDeniedResult } from '../core/result.js'
import type {
  Algorithm,
  AllowedResult,
  CheckOptions,
  Clock,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
  Store,
} from '../core/types.js'
import { createLimiter } from './create-limiter.js'

export interface SoftHardResult extends AllowedResult {
  warning: boolean
  grace: boolean
}

export interface SoftHardConfig {
  /** Soft limit - warnings start above this */
  softLimit: number
  /** Hard limit - requests denied above this */
  hardLimit: number
  /** Grace period requests allowed above hard limit. Default: 0 */
  graceRequests?: number | undefined
  /** Callback when soft limit is crossed */
  onSoftLimit?: ((key: string, result: RateLimitResult) => void) | undefined
}

function withSoftHardLimitImpl<TContext = string>(
  limiter: Limiter<TContext>,
  config: SoftHardConfig,
): Limiter<TContext> {
  const { softLimit, hardLimit, graceRequests = 0, onSoftLimit } = config

  return {
    ...limiter,
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const result = await limiter.check(ctx, options)

      if (!result.allowed) {
        // Check if within grace
        const used = result.limit - result.remaining
        if (graceRequests > 0 && used <= hardLimit + graceRequests) {
          // Within grace - allow but flag it
          const graceResult = createAllowedResult({
            limit: result.limit,
            remaining: Math.max(0, hardLimit + graceRequests - used),
            resetAt: result.resetAt,
            cost: result.cost,
          })
          return { ...graceResult, warning: true, grace: true } as unknown as RateLimitResult
        }
        return result
      }

      // Check if above soft limit (warning zone)
      const used = result.limit - result.remaining
      if (used >= softLimit) {
        if (onSoftLimit) {
          const key = typeof ctx === 'string' ? ctx : String(ctx)
          onSoftLimit(key, result)
        }
        return { ...result, warning: true, grace: false } as unknown as RateLimitResult
      }

      return { ...result, warning: false, grace: false } as unknown as RateLimitResult
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const result = await limiter.consume(ctx, options)
      // consume() only returns AllowedResult (throws on deny)
      // So we only need to check if above soft limit
      const used = result.limit - result.remaining
      if (used >= softLimit) {
        if (onSoftLimit) {
          const key = typeof ctx === 'string' ? ctx : String(ctx)
          onSoftLimit(key, result)
        }
        return { ...result, warning: true, grace: false } as unknown as AllowedResult
      }
      return { ...result, warning: false, grace: false } as unknown as AllowedResult
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

/**
 * Create a limiter with soft and hard limits.
 *
 * - Below softLimit: normal allowed
 * - Between soft and hard: allowed with `warning: true`
 * - Above hard but within grace: allowed with `grace: true`
 * - Above hard + grace: denied
 *
 * Curried form returns a transform for use with `pipe()`.
 */
export function withSoftHardLimit<TContext = string>(
  config: SoftHardConfig,
): (limiter: Limiter<TContext>) => Limiter<TContext>
export function withSoftHardLimit<TContext = string>(
  limiter: Limiter<TContext>,
  config: SoftHardConfig,
): Limiter<TContext>
export function withSoftHardLimit<TContext = string>(
  limiterOrConfig: Limiter<TContext> | SoftHardConfig,
  maybeConfig?: SoftHardConfig,
): Limiter<TContext> | ((limiter: Limiter<TContext>) => Limiter<TContext>) {
  if (!isLimiter<TContext>(limiterOrConfig)) {
    const config = limiterOrConfig
    return (limiter: Limiter<TContext>) => withSoftHardLimitImpl(limiter, config)
  }
  return withSoftHardLimitImpl(limiterOrConfig, maybeConfig!)
}

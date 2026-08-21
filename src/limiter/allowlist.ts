import { isLimiter } from '../core/guards.js'
import { createAllowedResult } from '../core/result.js'
import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export interface AllowlistConfig<TContext = string> {
  /** Static list of keys that bypass rate limiting */
  allowlist?: string[] | undefined
  /** Dynamic skip function - return true to bypass */
  skip?: ((ctx: TContext) => boolean | Promise<boolean>) | undefined
}

function withAllowlistImpl<TContext = string>(
  limiter: Limiter<TContext>,
  config: AllowlistConfig<TContext>,
): Limiter<TContext> {
  const { allowlist, skip } = config
  const allowSet = allowlist ? new Set(allowlist) : null

  function createBypassResult(): AllowedResult {
    return createAllowedResult({ limit: 0, remaining: 0, resetAt: 0, cost: 0 })
  }

  async function shouldSkip(ctx: TContext): Promise<boolean> {
    if (allowSet && typeof ctx === 'string' && allowSet.has(ctx)) {
      return true
    }
    if (skip) {
      return await skip(ctx)
    }
    return false
  }

  return {
    ...limiter,
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      if (await shouldSkip(ctx)) return createBypassResult()
      return limiter.check(ctx, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      if (await shouldSkip(ctx)) return createBypassResult()
      return limiter.consume(ctx, options)
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      if (await shouldSkip(ctx)) return null
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
 * Wrap a limiter with allowlist/skip logic.
 * Skipped requests never touch the store - zero overhead.
 *
 * Curried form returns a transform for use with `pipe()`.
 */
export function withAllowlist<TContext = string>(
  config: AllowlistConfig<TContext>,
): (limiter: Limiter<TContext>) => Limiter<TContext>
export function withAllowlist<TContext = string>(
  limiter: Limiter<TContext>,
  config: AllowlistConfig<TContext>,
): Limiter<TContext>
export function withAllowlist<TContext = string>(
  limiterOrConfig: Limiter<TContext> | AllowlistConfig<TContext>,
  maybeConfig?: AllowlistConfig<TContext>,
): Limiter<TContext> | ((limiter: Limiter<TContext>) => Limiter<TContext>) {
  if (!isLimiter<TContext>(limiterOrConfig)) {
    const config = limiterOrConfig
    return (limiter: Limiter<TContext>) => withAllowlistImpl(limiter, config)
  }
  return withAllowlistImpl(limiterOrConfig, maybeConfig!)
}

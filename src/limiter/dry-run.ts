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

export interface DryRunHooks {
  /** Called when a request WOULD have been denied (but was allowed due to dry run) */
  onShadowDeny?: ((key: string, result: RateLimitResult) => void) | undefined
}

function withDryRunImpl<TContext = string>(
  limiter: Limiter<TContext>,
  hooks?: DryRunHooks,
): Limiter<TContext> {
  return {
    ...limiter,
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const result = await limiter.check(ctx, options)

      if (!result.allowed) {
        hooks?.onShadowDeny?.(String(ctx), result)
        // Return an allowed result in dry-run mode
        return createAllowedResult({
          limit: result.limit,
          remaining: result.remaining,
          resetAt: result.resetAt,
          cost: result.cost,
        })
      }

      return result
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const result = await limiter.check(ctx, options)

      if (!result.allowed) {
        hooks?.onShadowDeny?.(String(ctx), result)
      }

      // Always return allowed in dry-run
      return createAllowedResult({
        limit: result.limit,
        remaining: result.remaining,
        resetAt: result.resetAt,
        cost: result.cost,
      })
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
 * Wrap a limiter in dry-run mode.
 *
 * In dry-run mode, all requests are allowed but the limiter still
 * processes them normally. This is useful for testing/shadowing
 * rate limit configuration before enforcing it.
 *
 * Curried forms return a transform for use with `pipe()`.
 */
export function withDryRun<TContext = string>(): (limiter: Limiter<TContext>) => Limiter<TContext>
export function withDryRun<TContext = string>(
  hooks: DryRunHooks,
): (limiter: Limiter<TContext>) => Limiter<TContext>
export function withDryRun<TContext = string>(
  limiter: Limiter<TContext>,
  hooks?: DryRunHooks,
): Limiter<TContext>
export function withDryRun<TContext = string>(
  limiterOrHooks?: Limiter<TContext> | DryRunHooks,
  maybeHooks?: DryRunHooks,
): Limiter<TContext> | ((limiter: Limiter<TContext>) => Limiter<TContext>) {
  // No args → curried with no hooks
  if (limiterOrHooks === undefined) {
    return (limiter: Limiter<TContext>) => withDryRunImpl(limiter)
  }
  // First arg is a Limiter → direct application
  if (isLimiter<TContext>(limiterOrHooks)) {
    return withDryRunImpl(limiterOrHooks, maybeHooks)
  }
  // First arg is hooks → curried with hooks
  const hooks = limiterOrHooks
  return (limiter: Limiter<TContext>) => withDryRunImpl(limiter, hooks)
}

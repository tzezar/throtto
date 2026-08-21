import { isLimiter } from '../core/guards.js'
import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export interface ThresholdLevel {
  /** Percentage of limit used that triggers this threshold (0-100) */
  percent: number
  /** Callback fired when threshold is crossed */
  onThreshold: (key: string, percent: number, result: RateLimitResult) => void
  /** Fire only once per window (resets when remaining goes back up). Default: true */
  once?: boolean | undefined
}

export interface ThresholdConfig<TContext = string> {
  thresholds: ThresholdLevel[]
}

function withThresholdsImpl<TContext = string>(
  limiter: Limiter<TContext>,
  config: ThresholdConfig<TContext>,
): Limiter<TContext> {
  const { thresholds } = config
  const sorted = [...thresholds].sort((a, b) => a.percent - b.percent)
  const MAX_FIRED_MAP_SIZE = 10_000
  const firedMap = new Map<string, Set<number>>()

  function checkThresholds(key: string, result: RateLimitResult): void {
    if (result.limit === 0) return

    const used = result.limit - result.remaining
    const percentUsed = (used / result.limit) * 100

    if (!firedMap.has(key)) {
      // Evict oldest if too large
      if (firedMap.size >= MAX_FIRED_MAP_SIZE) {
        const oldest = firedMap.keys().next().value
        if (oldest !== undefined) firedMap.delete(oldest)
      }
      firedMap.set(key, new Set())
    }
    const fired = firedMap.get(key)!

    // If remaining went back up (window reset), clear fired set
    if (percentUsed < (sorted[0]?.percent ?? 0)) {
      fired.clear()
    }

    for (const threshold of sorted) {
      if (percentUsed >= threshold.percent) {
        const once = threshold.once !== false
        if (once && fired.has(threshold.percent)) continue
        fired.add(threshold.percent)
        threshold.onThreshold(key, percentUsed, result)
      }
    }
  }

  return {
    ...limiter,
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const result = await limiter.check(ctx, options)
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      checkThresholds(key, result)
      return result
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const result = await limiter.consume(ctx, options)
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      checkThresholds(key, result)
      return result
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      return limiter.peek(ctx)
    },

    async reset(ctx: TContext): Promise<void> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      firedMap.delete(key)
      return limiter.reset(ctx)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      firedMap.clear()
      return limiter.shutdown(options)
    },
  }
}

/**
 * Wrap a limiter with threshold alerts.
 *
 * Fires callbacks when usage crosses configurable percentage thresholds.
 * Useful for monitoring and early warning systems.
 *
 * Curried form returns a transform for use with `pipe()`.
 */
export function withThresholds<TContext = string>(
  config: ThresholdConfig<TContext>,
): (limiter: Limiter<TContext>) => Limiter<TContext>
export function withThresholds<TContext = string>(
  limiter: Limiter<TContext>,
  config: ThresholdConfig<TContext>,
): Limiter<TContext>
export function withThresholds<TContext = string>(
  limiterOrConfig: Limiter<TContext> | ThresholdConfig<TContext>,
  maybeConfig?: ThresholdConfig<TContext>,
): Limiter<TContext> | ((limiter: Limiter<TContext>) => Limiter<TContext>) {
  if (!isLimiter<TContext>(limiterOrConfig)) {
    const config = limiterOrConfig
    return (limiter: Limiter<TContext>) => withThresholdsImpl(limiter, config)
  }
  return withThresholdsImpl(limiterOrConfig, maybeConfig!)
}

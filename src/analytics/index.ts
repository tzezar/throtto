import type {
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'
import { createCollector } from './collector.js'
import type { AggregatedMetrics, AnalyticsEvent, Collector, CollectorConfig } from './collector.js'
import { createAnalyticsStream } from './stream.js'
import type { AnalyticsStream } from './stream.js'

export type { AnalyticsEvent, AggregatedMetrics, CollectorConfig, Collector } from './collector.js'
export { createCollector } from './collector.js'
export { toPrometheus, toJSON, toCSV } from './exporters.js'
export type { PrometheusOptions } from './exporters.js'
export { createAnalyticsStream } from './stream.js'
export type { AnalyticsStream, StreamConfig } from './stream.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnalyticsConfig {
  /** Collector configuration */
  collector?: CollectorConfig | undefined
  /** Whether to enable the event stream. Default: false */
  enableStream?: boolean | undefined
}

export interface AnalyticsLimiter extends Limiter {
  /** Get current aggregated metrics */
  getMetrics(): AggregatedMetrics
  /** Get the event stream (if enabled) */
  getStream(): AnalyticsStream | null
  /** Get the collector instance */
  getCollector(): Collector
  /** Reset analytics data */
  resetAnalytics(): void
}

// ─── Wrapper ─────────────────────────────────────────────────────────────────

/**
 * Wraps a limiter with analytics collection.
 *
 * Usage:
 * ```ts
 * const limiter = rateLimit('100/minute')
 * const analyticsLimiter = withAnalytics(limiter)
 *
 * // Use normally
 * await analyticsLimiter.check('user-1')
 *
 * // Get metrics
 * const metrics = analyticsLimiter.getMetrics()
 * console.log(metrics.denyRate)
 * ```
 */
export function withAnalytics(limiter: Limiter, config: AnalyticsConfig = {}): AnalyticsLimiter {
  const collector = createCollector(config.collector)
  const stream = config.enableStream ? createAnalyticsStream() : null

  function recordEvent(key: string, result: RateLimitResult, startTime: number): void {
    const event: AnalyticsEvent = {
      key,
      allowed: result.allowed,
      cost: result.cost,
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
      limit: result.limit,
      remaining: result.remaining,
    }
    collector.record(event)
    if (stream) stream.push(event)
  }

  return {
    async check(ctx: string, options?: CheckOptions): Promise<RateLimitResult> {
      const start = Date.now()
      const result = await limiter.check(ctx, options)
      recordEvent(ctx, result, start)
      return result
    },

    async consume(ctx: string, options?: CheckOptions) {
      const start = Date.now()
      const result = await limiter.consume(ctx, options)
      recordEvent(ctx, result, start)
      return result
    },

    async peek(ctx: string): Promise<RateLimitInfo | null> {
      return limiter.peek(ctx)
    },

    async reset(ctx: string): Promise<void> {
      return limiter.reset(ctx)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      collector.shutdown()
      await limiter.shutdown(options)
    },

    getMetrics(): AggregatedMetrics {
      return collector.getMetrics()
    },

    getStream(): AnalyticsStream | null {
      return stream
    },

    getCollector(): Collector {
      return collector
    },

    resetAnalytics(): void {
      collector.reset()
    },
  }
}

import type { CheckOptions, Limiter, RateLimitResult } from '../core/types.js'

export type BackpressureStrategy = 'delay' | 'shed' | 'adaptive'

export interface BackpressureConfig {
  /** Strategy for handling overload */
  strategy?: BackpressureStrategy | undefined
  /** Maximum delay before shedding (ms). Default: 5000 */
  maxDelay?: number | undefined
  /** Base delay increment (ms). Default: 100 */
  baseDelay?: number | undefined
}

export interface BackpressureSignal {
  /** Current pressure level (0-1) */
  pressure: number
  /** Recommended action */
  action: 'proceed' | 'slow-down' | 'shed'
  /** Suggested delay (ms) */
  delay: number
}

declare function setTimeout(fn: () => void, ms: number): unknown

/**
 * Create a backpressure signal from a limiter's state.
 *
 * Provides graduated responses to load:
 * - Low pressure (0-0.5): proceed normally
 * - Medium pressure (0.5-0.9): slow down (add delay)
 * - High pressure (0.9-1.0): shed load
 */
export function getBackpressure(
  result: RateLimitResult,
  config: BackpressureConfig = {},
): BackpressureSignal {
  const { maxDelay = 5000, baseDelay = 100 } = config

  if (!result.allowed) {
    return { pressure: 1, action: 'shed', delay: maxDelay }
  }

  if (result.limit === 0) {
    return { pressure: 0, action: 'proceed', delay: 0 }
  }

  const used = result.limit - result.remaining
  const pressure = used / result.limit

  if (pressure < 0.5) {
    return { pressure, action: 'proceed', delay: 0 }
  }

  if (pressure < 0.9) {
    const delay = Math.round(baseDelay * ((pressure - 0.5) / 0.4) * (maxDelay / baseDelay) * 0.5)
    return { pressure, action: 'slow-down', delay: Math.min(delay, maxDelay) }
  }

  const delay = Math.round(maxDelay * ((pressure - 0.9) / 0.1))
  return { pressure, action: 'shed', delay: Math.min(delay, maxDelay) }
}

/**
 * Apply backpressure delay to a function call.
 */
export async function withBackpressure<T>(
  limiter: Limiter,
  key: string,
  fn: () => Promise<T>,
  config?: BackpressureConfig,
): Promise<T> {
  const result = await limiter.check(key)
  const signal = getBackpressure(result, config)

  if (signal.action === 'shed' && !result.allowed) {
    throw new Error('Backpressure: load shedding')
  }

  if (signal.delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, signal.delay))
  }

  return fn()
}

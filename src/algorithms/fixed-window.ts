import { parseDuration } from '../core/duration.js'
import type { Algorithm, AlgorithmResult, RateLimitInfo } from '../core/types.js'
import type { Duration } from '../core/types.js'

export interface FixedWindowConfig {
  /** Maximum number of requests allowed per window */
  limit: number
  /** Window duration (e.g. '1m', '1h', 60000) */
  window: Duration
  /** Align windows to clock boundaries (e.g. start of minute/hour) */
  alignment?: 'none' | 'floor' | undefined
}

export interface FixedWindowState {
  count: number
  windowStart: number
}

export function fixedWindow(config: FixedWindowConfig): Algorithm<FixedWindowState> {
  const { limit, alignment = 'none' } = config
  const windowMs = parseDuration(config.window)

  function getWindowStart(now: number): number {
    if (alignment === 'floor') {
      return Math.floor(now / windowMs) * windowMs
    }
    return now
  }

  return {
    type: 'fixed-window',

    initialState(): FixedWindowState {
      return { count: 0, windowStart: 0 }
    },

    check(
      state: FixedWindowState | null,
      now: number,
      cost = 1,
    ): AlgorithmResult<FixedWindowState> {
      const currentWindowStart = state?.windowStart ?? getWindowStart(now)
      const windowEnd = currentWindowStart + windowMs

      // Check if we're in a new window
      let count: number
      let windowStart: number

      if (state === null || now >= windowEnd) {
        // New window
        windowStart = alignment === 'floor' ? getWindowStart(now) : now
        count = 0
      } else {
        // Same window
        windowStart = currentWindowStart
        count = state.count
      }

      const resetAt = windowStart + windowMs
      const remaining = Math.max(0, limit - count)
      const allowed = count + cost <= limit

      if (allowed) {
        const newState: FixedWindowState = { count: count + cost, windowStart }
        return {
          allowed: true,
          state: newState,
          info: {
            limit,
            remaining: Math.max(0, limit - count - cost),
            resetAt,
          },
          ttlMs: resetAt - now,
        }
      }

      return {
        allowed: false,
        state: { count, windowStart },
        info: {
          limit,
          remaining: 0,
          resetAt,
          retryAfter: resetAt - now,
        },
        ttlMs: resetAt - now,
      }
    },

    peek(state: FixedWindowState | null, now: number): RateLimitInfo {
      if (state === null) {
        return { limit, remaining: limit, resetAt: now + windowMs }
      }

      const windowEnd = state.windowStart + windowMs

      if (now >= windowEnd) {
        return {
          limit,
          remaining: limit,
          resetAt: (alignment === 'floor' ? getWindowStart(now) : now) + windowMs,
        }
      }

      return {
        limit,
        remaining: Math.max(0, limit - state.count),
        resetAt: windowEnd,
      }
    },
  }
}

import { parseDuration } from '../core/duration.js'
import type { Algorithm, AlgorithmResult, Duration, RateLimitInfo } from '../core/types.js'

export interface SlidingWindowLogConfig {
  /** Maximum requests allowed within the window */
  limit: number
  /** Window duration (e.g. '1m', '1h', 60000) */
  window: Duration
}

export interface SlidingWindowLogState {
  timestamps: number[]
}

/**
 * Sliding Window Log algorithm.
 *
 * Maintains a sorted log of request timestamps. On each check,
 * timestamps outside the window are pruned. The count of remaining
 * timestamps determines whether the request is allowed.
 *
 * Most accurate but most memory-intensive algorithm.
 */
export function slidingWindowLog(config: SlidingWindowLogConfig): Algorithm<SlidingWindowLogState> {
  const { limit } = config
  const windowMs = parseDuration(config.window)

  function prune(timestamps: number[], now: number): number[] {
    const cutoff = now - windowMs
    // Find the first timestamp that's within the window
    let start = 0
    while (start < timestamps.length && timestamps[start]! <= cutoff) {
      start++
    }
    return start === 0 ? timestamps : timestamps.slice(start)
  }

  return {
    type: 'sliding-window-log',

    initialState(): SlidingWindowLogState {
      return { timestamps: [] }
    },

    check(
      state: SlidingWindowLogState | null,
      now: number,
      cost = 1,
    ): AlgorithmResult<SlidingWindowLogState> {
      const current = state ? prune(state.timestamps, now) : []
      const count = current.length
      const allowed = count + cost <= limit

      if (allowed) {
        // Add `cost` timestamps for this request
        const newTimestamps = [...current]
        for (let i = 0; i < cost; i++) {
          newTimestamps.push(now)
        }

        const oldestInWindow = newTimestamps[0] ?? now
        const resetAt = oldestInWindow + windowMs

        return {
          allowed: true,
          state: { timestamps: newTimestamps },
          info: {
            limit,
            remaining: Math.max(0, limit - newTimestamps.length),
            resetAt,
          },
          ttlMs: windowMs,
        }
      }

      // Denied - find when the oldest entry will expire
      const oldestInWindow = current[0] ?? now
      const resetAt = oldestInWindow + windowMs
      const retryAfter = resetAt - now

      return {
        allowed: false,
        state: { timestamps: current },
        info: {
          limit,
          remaining: 0,
          resetAt,
          retryAfter: Math.max(0, retryAfter),
        },
        ttlMs: windowMs,
      }
    },

    peek(state: SlidingWindowLogState | null, now: number): RateLimitInfo {
      if (state === null) {
        return { limit, remaining: limit, resetAt: now + windowMs }
      }

      const current = prune(state.timestamps, now)
      const oldestInWindow = current[0] ?? now
      const resetAt = oldestInWindow + windowMs

      return {
        limit,
        remaining: Math.max(0, limit - current.length),
        resetAt,
      }
    },
  }
}

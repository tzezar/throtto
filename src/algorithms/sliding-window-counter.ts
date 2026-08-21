import { parseDuration } from '../core/duration.js'
import type { Algorithm, AlgorithmResult, Duration, RateLimitInfo } from '../core/types.js'

export interface SlidingWindowCounterConfig {
  /** Maximum number of requests allowed per window */
  limit: number
  /** Window duration (e.g. '1m', '1h', 60000) */
  window: Duration
}

export interface SlidingWindowCounterState {
  currentCount: number
  previousCount: number
  windowStart: number
}

/**
 * Sliding Window Counter algorithm.
 *
 * Uses weighted approximation to smooth out fixed window boundary spikes.
 * Formula: effectiveCount = previousWindowCount * overlapRatio + currentWindowCount
 *
 * Where overlapRatio = (windowMs - elapsedInCurrentWindow) / windowMs
 */
export function slidingWindowCounter(
  config: SlidingWindowCounterConfig,
): Algorithm<SlidingWindowCounterState> {
  const { limit } = config
  const windowMs = parseDuration(config.window)

  function getEffectiveCount(state: SlidingWindowCounterState, now: number): number {
    const elapsed = now - state.windowStart
    const overlapRatio = Math.max(0, (windowMs - elapsed) / windowMs)
    return state.previousCount * overlapRatio + state.currentCount
  }

  function advanceWindow(state: SlidingWindowCounterState, now: number): SlidingWindowCounterState {
    const elapsed = now - state.windowStart

    if (elapsed >= windowMs * 2) {
      // More than 2 windows have passed - both windows are stale
      return { currentCount: 0, previousCount: 0, windowStart: now }
    }

    if (elapsed >= windowMs) {
      // Current window expired, rotate
      return {
        currentCount: 0,
        previousCount: state.currentCount,
        windowStart: state.windowStart + windowMs,
      }
    }

    // Still in current window
    return state
  }

  return {
    type: 'sliding-window-counter',

    initialState(): SlidingWindowCounterState {
      return { currentCount: 0, previousCount: 0, windowStart: 0 }
    },

    check(
      state: SlidingWindowCounterState | null,
      now: number,
      cost = 1,
    ): AlgorithmResult<SlidingWindowCounterState> {
      // Initialize or advance window
      let current: SlidingWindowCounterState
      if (state === null) {
        current = { currentCount: 0, previousCount: 0, windowStart: now }
      } else {
        current = advanceWindow(state, now)
      }

      const effectiveCount = getEffectiveCount(current, now)
      const resetAt = current.windowStart + windowMs
      const allowed = effectiveCount + cost <= limit

      if (allowed) {
        const newState: SlidingWindowCounterState = {
          ...current,
          currentCount: current.currentCount + cost,
        }
        const newEffective = getEffectiveCount(newState, now)
        return {
          allowed: true,
          state: newState,
          info: {
            limit,
            remaining: Math.max(0, Math.floor(limit - newEffective)),
            resetAt,
          },
          ttlMs: resetAt - now + windowMs, // keep previous window data alive
        }
      }

      return {
        allowed: false,
        state: current,
        info: {
          limit,
          remaining: 0,
          resetAt,
          retryAfter: resetAt - now,
        },
        ttlMs: resetAt - now + windowMs,
      }
    },

    peek(state: SlidingWindowCounterState | null, now: number): RateLimitInfo {
      if (state === null) {
        return { limit, remaining: limit, resetAt: now + windowMs }
      }

      const current = advanceWindow(state, now)
      const effectiveCount = getEffectiveCount(current, now)
      const resetAt = current.windowStart + windowMs

      return {
        limit,
        remaining: Math.max(0, Math.floor(limit - effectiveCount)),
        resetAt,
      }
    },
  }
}

import { parseDuration } from '../core/duration.js'
import type { Algorithm, AlgorithmResult, Duration, RateLimitInfo } from '../core/types.js'

export interface GcraConfig {
  /** Maximum number of requests allowed per period */
  limit: number
  /** Time period (e.g. '1m', '1h') */
  period: Duration
  /** Maximum burst size. Defaults to limit. */
  burst?: number | undefined
}

export interface GcraState {
  /** Theoretical Arrival Time - the earliest time the next request should arrive */
  tat: number
}

/**
 * Generic Cell Rate Algorithm (GCRA).
 *
 * Also known as "virtual scheduling" or "leaky bucket as a meter".
 * Uses a single timestamp (TAT) for state - extremely memory efficient.
 *
 * Concept:
 * - emission_interval = period / limit (time between ideal requests)
 * - delay_tolerance = emission_interval * burst (max burst window)
 * - TAT = max(now, previous_tat) + emission_interval * cost
 * - Allow if TAT - now <= delay_tolerance
 */
export function gcra(config: GcraConfig): Algorithm<GcraState> {
  const { limit } = config
  const periodMs = parseDuration(config.period)
  const burst = config.burst ?? limit
  const emissionInterval = periodMs / limit
  const delayTolerance = emissionInterval * burst

  return {
    type: 'gcra',

    initialState(): GcraState {
      return { tat: 0 }
    },

    check(state: GcraState | null, now: number, cost = 1): AlgorithmResult<GcraState> {
      const tat = state?.tat ?? now
      const increment = emissionInterval * cost

      // New TAT if we allow this request
      const newTat = Math.max(tat, now) + increment

      // Check if the new TAT would exceed our tolerance
      const allowAt = newTat - delayTolerance

      if (allowAt <= now) {
        // Allowed
        const remaining = Math.max(
          0,
          Math.floor((delayTolerance - (newTat - now)) / emissionInterval),
        )
        const resetAt = newTat

        return {
          allowed: true,
          state: { tat: newTat },
          info: {
            limit: burst,
            remaining,
            resetAt: Math.ceil(resetAt),
          },
          ttlMs: Math.ceil(newTat - now),
        }
      }

      // Denied
      const retryAfter = Math.ceil(allowAt - now)
      const currentRemaining = Math.max(
        0,
        Math.floor((delayTolerance - (tat - now)) / emissionInterval),
      )
      const resetAt = tat

      return {
        allowed: false,
        state: { tat: state?.tat ?? now },
        info: {
          limit: burst,
          remaining: currentRemaining,
          resetAt: Math.ceil(resetAt),
          retryAfter,
        },
        ttlMs: Math.ceil(Math.max(0, tat - now)),
      }
    },

    peek(state: GcraState | null, now: number): RateLimitInfo {
      if (state === null) {
        return { limit: burst, remaining: burst, resetAt: now }
      }

      const tat = state.tat
      if (tat <= now) {
        // TAT is in the past - fully reset
        return { limit: burst, remaining: burst, resetAt: now }
      }

      const remaining = Math.max(0, Math.floor((delayTolerance - (tat - now)) / emissionInterval))
      return {
        limit: burst,
        remaining,
        resetAt: Math.ceil(tat),
      }
    },
  }
}

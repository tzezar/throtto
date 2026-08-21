import { parseDuration } from '../core/duration.js'
import type { Algorithm, AlgorithmResult, Duration, RateLimitInfo } from '../core/types.js'

export interface TokenBucketConfig {
  /** Maximum number of tokens the bucket can hold */
  capacity: number
  /** Number of tokens to add per refill interval */
  refillRate: number
  /** How often tokens are refilled (e.g. '1s', '100ms'). Defaults to '1s'. */
  refillInterval?: Duration | undefined
}

export interface TokenBucketState {
  tokens: number
  lastRefill: number
}

/**
 * Token Bucket algorithm.
 *
 * The bucket starts full (at capacity). Each request consumes tokens.
 * Tokens are refilled at a constant rate. The refill is computed lazily
 * on each check (no timers needed).
 */
export function tokenBucket(config: TokenBucketConfig): Algorithm<TokenBucketState> {
  const { capacity, refillRate } = config
  const refillIntervalMs = parseDuration(config.refillInterval ?? '1s')

  function refill(state: TokenBucketState, now: number): TokenBucketState {
    const elapsed = now - state.lastRefill
    if (elapsed <= 0) return state

    const intervalsElapsed = Math.floor(elapsed / refillIntervalMs)
    if (intervalsElapsed === 0) return state

    const tokensToAdd = intervalsElapsed * refillRate
    const newTokens = Math.min(capacity, state.tokens + tokensToAdd)
    const newLastRefill = state.lastRefill + intervalsElapsed * refillIntervalMs

    return { tokens: newTokens, lastRefill: newLastRefill }
  }

  function timeUntilTokens(state: TokenBucketState, needed: number): number {
    if (state.tokens >= needed) return 0
    const deficit = needed - state.tokens
    const intervalsNeeded = Math.ceil(deficit / refillRate)
    return intervalsNeeded * refillIntervalMs
  }

  return {
    type: 'token-bucket',

    initialState(): TokenBucketState {
      return { tokens: capacity, lastRefill: 0 }
    },

    check(
      state: TokenBucketState | null,
      now: number,
      cost = 1,
    ): AlgorithmResult<TokenBucketState> {
      // Initialize with full bucket
      let current: TokenBucketState
      if (state === null) {
        current = { tokens: capacity, lastRefill: now }
      } else {
        current = refill(state, now)
      }

      const allowed = current.tokens >= cost

      if (allowed) {
        const newState: TokenBucketState = {
          tokens: current.tokens - cost,
          lastRefill: current.lastRefill,
        }
        // Time until full refill from empty
        const timeToFull = timeUntilTokens(newState, capacity)
        return {
          allowed: true,
          state: newState,
          info: {
            limit: capacity,
            remaining: Math.floor(newState.tokens),
            resetAt: now + timeToFull,
          },
          ttlMs: Math.max(refillIntervalMs, timeToFull),
        }
      }

      const retryAfter = timeUntilTokens(current, cost)
      const timeToFull = timeUntilTokens(current, capacity)
      return {
        allowed: false,
        state: current,
        info: {
          limit: capacity,
          remaining: Math.floor(current.tokens),
          resetAt: now + timeToFull,
          retryAfter,
        },
        ttlMs: Math.max(refillIntervalMs, timeToFull),
      }
    },

    peek(state: TokenBucketState | null, now: number): RateLimitInfo {
      if (state === null) {
        return { limit: capacity, remaining: capacity, resetAt: now }
      }

      const current = refill(state, now)
      const timeToFull = timeUntilTokens(current, capacity)

      return {
        limit: capacity,
        remaining: Math.floor(current.tokens),
        resetAt: now + timeToFull,
      }
    },
  }
}

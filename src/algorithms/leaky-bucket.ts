import { parseDuration } from '../core/duration.js'
import type { Algorithm, AlgorithmResult, Duration, RateLimitInfo } from '../core/types.js'

export interface LeakyBucketConfig {
  /** Maximum capacity of the bucket (queue size) */
  capacity: number
  /** Number of items that leak (drain) per interval */
  leakRate: number
  /** How often the bucket leaks (e.g. '1s'). Defaults to '1s'. */
  leakInterval?: Duration | undefined
}

export interface LeakyBucketState {
  queueSize: number
  lastLeak: number
}

/**
 * Leaky Bucket algorithm.
 *
 * The bucket has a fixed capacity. Each request adds to the queue.
 * Items leak out at a constant rate. If the bucket is full, requests are denied.
 * The leak is computed lazily on each check.
 */
export function leakyBucket(config: LeakyBucketConfig): Algorithm<LeakyBucketState> {
  const { capacity, leakRate } = config
  const leakIntervalMs = parseDuration(config.leakInterval ?? '1s')

  function leak(state: LeakyBucketState, now: number): LeakyBucketState {
    const elapsed = now - state.lastLeak
    if (elapsed <= 0) return state

    const intervalsElapsed = Math.floor(elapsed / leakIntervalMs)
    if (intervalsElapsed === 0) return state

    const leaked = intervalsElapsed * leakRate
    const newQueueSize = Math.max(0, state.queueSize - leaked)
    const newLastLeak = state.lastLeak + intervalsElapsed * leakIntervalMs

    return { queueSize: newQueueSize, lastLeak: newLastLeak }
  }

  function timeUntilSpace(state: LeakyBucketState, needed: number): number {
    const excess = state.queueSize + needed - capacity
    if (excess <= 0) return 0
    const intervalsNeeded = Math.ceil(excess / leakRate)
    return intervalsNeeded * leakIntervalMs
  }

  function timeUntilEmpty(state: LeakyBucketState): number {
    if (state.queueSize <= 0) return 0
    const intervalsNeeded = Math.ceil(state.queueSize / leakRate)
    return intervalsNeeded * leakIntervalMs
  }

  return {
    type: 'leaky-bucket',

    initialState(): LeakyBucketState {
      return { queueSize: 0, lastLeak: 0 }
    },

    check(
      state: LeakyBucketState | null,
      now: number,
      cost = 1,
    ): AlgorithmResult<LeakyBucketState> {
      let current: LeakyBucketState
      if (state === null) {
        current = { queueSize: 0, lastLeak: now }
      } else {
        current = leak(state, now)
      }

      const allowed = current.queueSize + cost <= capacity

      if (allowed) {
        const newState: LeakyBucketState = {
          queueSize: current.queueSize + cost,
          lastLeak: current.lastLeak,
        }
        const ttl = timeUntilEmpty(newState)
        return {
          allowed: true,
          state: newState,
          info: {
            limit: capacity,
            remaining: Math.max(0, Math.floor(capacity - newState.queueSize)),
            resetAt: now + ttl,
          },
          ttlMs: Math.max(leakIntervalMs, ttl),
        }
      }

      const retryAfter = timeUntilSpace(current, cost)
      const ttl = timeUntilEmpty(current)
      return {
        allowed: false,
        state: current,
        info: {
          limit: capacity,
          remaining: 0,
          resetAt: now + ttl,
          retryAfter,
        },
        ttlMs: Math.max(leakIntervalMs, ttl),
      }
    },

    peek(state: LeakyBucketState | null, now: number): RateLimitInfo {
      if (state === null) {
        return { limit: capacity, remaining: capacity, resetAt: now }
      }

      const current = leak(state, now)
      const ttl = timeUntilEmpty(current)

      return {
        limit: capacity,
        remaining: Math.max(0, Math.floor(capacity - current.queueSize)),
        resetAt: now + ttl,
      }
    },
  }
}

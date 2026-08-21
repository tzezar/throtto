import { parseDuration } from '../core/duration.js'
import type { Duration } from '../core/types.js'

export interface QuotaConfig {
  /** Total quota for the period */
  limit: number
  /** Quota period (e.g. '1d', '30d') */
  period: Duration
  /** Max tracked keys. Default: 100000 */
  maxKeys?: number | undefined
}

export interface QuotaState {
  used: number
  remaining: number
  limit: number
  resetsAt: number
  percentUsed: number
}

/**
 * Create a simple quota tracker.
 *
 * Tracks usage against a fixed quota that resets periodically.
 * Useful for daily/monthly API quotas.
 */
export function createQuota(config: QuotaConfig) {
  const { limit } = config
  const periodMs = parseDuration(config.period)
  const maxKeys = config.maxKeys ?? 100_000
  const usage = new Map<string, { used: number; windowStart: number }>()

  function getEntry(key: string): { used: number; windowStart: number } {
    const now = Date.now()
    let entry = usage.get(key)
    if (!entry || now - entry.windowStart >= periodMs) {
      // Evict oldest if at capacity
      if (!usage.has(key) && usage.size >= maxKeys) {
        const oldest = usage.keys().next().value
        if (oldest !== undefined) usage.delete(oldest)
      }
      entry = { used: 0, windowStart: now }
      usage.set(key, entry)
    }
    return entry
  }

  return {
    /** Check if quota is available (does NOT consume) */
    check(key: string, cost = 1): QuotaState {
      const entry = getEntry(key)
      const remaining = Math.max(0, limit - entry.used)
      return {
        used: entry.used,
        remaining,
        limit,
        resetsAt: entry.windowStart + periodMs,
        percentUsed: (entry.used / limit) * 100,
      }
    },

    /** Consume quota. Returns false if insufficient. */
    consume(key: string, cost = 1): boolean {
      const entry = getEntry(key)
      if (entry.used + cost > limit) return false
      entry.used += cost
      return true
    },

    /** Get current state */
    getState(key: string): QuotaState {
      return this.check(key)
    },

    /** Reset quota for a key */
    reset(key: string): void {
      usage.delete(key)
    },

    /** Reset all quotas */
    resetAll(): void {
      usage.clear()
    },
  }
}

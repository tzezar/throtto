export interface PenaltyBoxConfig {
  /** Penalty levels - escalating restrictions */
  levels: PenaltyLevel[]
  /** Time after which penalties decay (ms). Default: 300000 (5 min) */
  decayAfter?: number | undefined
  /** Max tracked keys. Default: 10000 */
  maxEntries?: number | undefined
}

export interface PenaltyLevel {
  /** Number of violations to trigger this level */
  violations: number
  /** Penalty duration (ms) */
  duration: number
  /** Multiplier applied to rate limit (e.g., 0.5 = halved) */
  multiplier?: number | undefined
}

export interface PenaltyBox {
  /** Record a violation for a key */
  penalize(key: string): PenaltyStatus
  /** Get current penalty status */
  getStatus(key: string): PenaltyStatus
  /** Check if a key is currently penalized */
  isPenalized(key: string): boolean
  /** Clear penalty for a key */
  clear(key: string): void
  /** Clear all penalties */
  clearAll(): void
}

export interface PenaltyStatus {
  penalized: boolean
  level: number
  violations: number
  multiplier: number
  expiresAt: number | null
}

/**
 * Create a penalty box for escalating restrictions.
 *
 * @example
 * ```ts
 * const penalties = createPenaltyBox({
 *   levels: [
 *     { violations: 3, duration: 60000, multiplier: 0.5 },
 *     { violations: 5, duration: 300000, multiplier: 0.1 },
 *     { violations: 10, duration: 3600000, multiplier: 0 },
 *   ],
 *   decayAfter: 600000,
 * })
 * ```
 */
export function createPenaltyBox(config: PenaltyBoxConfig): PenaltyBox {
  const { levels, decayAfter = 300000 } = config
  const maxEntries = config.maxEntries ?? 10_000
  const sortedLevels = [...levels].sort((a, b) => a.violations - b.violations)
  const state = new Map<
    string,
    { violations: number; lastViolation: number; penaltyExpires: number }
  >()

  function getEntry(key: string) {
    const existing = state.get(key)
    if (existing) {
      // Decay violations if enough time has passed
      if (existing.lastViolation > 0 && Date.now() - existing.lastViolation > decayAfter) {
        state.delete(key) // Clean up decayed entry
        return { violations: 0, lastViolation: 0, penaltyExpires: 0 }
      }
      return existing
    }
    return { violations: 0, lastViolation: 0, penaltyExpires: 0 }
  }

  function resolveLevel(violations: number): PenaltyLevel | null {
    let matched: PenaltyLevel | null = null
    for (const level of sortedLevels) {
      if (violations >= level.violations) {
        matched = level
      }
    }
    return matched
  }

  return {
    penalize(key: string): PenaltyStatus {
      let entry = state.get(key)
      // Decay check
      if (entry && entry.lastViolation > 0 && Date.now() - entry.lastViolation > decayAfter) {
        state.delete(key)
        entry = undefined
      }
      if (!entry) {
        // Evict oldest if at capacity
        if (state.size >= maxEntries) {
          const oldest = state.keys().next().value
          if (oldest !== undefined) state.delete(oldest)
        }
        entry = { violations: 0, lastViolation: 0, penaltyExpires: 0 }
        state.set(key, entry)
      }
      entry.violations++
      entry.lastViolation = Date.now()

      const level = resolveLevel(entry.violations)
      if (level) {
        entry.penaltyExpires = Date.now() + level.duration
      }

      return this.getStatus(key)
    },

    getStatus(key: string): PenaltyStatus {
      const entry = getEntry(key)
      const now = Date.now()
      const penalized = entry.penaltyExpires > now
      const level = resolveLevel(entry.violations)
      const levelIndex = level ? sortedLevels.indexOf(level) + 1 : 0

      return {
        penalized,
        level: levelIndex,
        violations: entry.violations,
        multiplier: penalized && level ? (level.multiplier ?? 1) : 1,
        expiresAt: penalized ? entry.penaltyExpires : null,
      }
    },

    isPenalized(key: string): boolean {
      const entry = getEntry(key)
      return entry.penaltyExpires > Date.now()
    },

    clear(key: string): void {
      state.delete(key)
    },

    clearAll(): void {
      state.clear()
    },
  }
}

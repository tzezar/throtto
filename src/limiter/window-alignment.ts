/**
 * Window alignment utilities.
 *
 * Calculate aligned window starts for use with rate limiters
 * that need clock-synchronized windows across distributed instances.
 */

export type AlignmentStrategy = 'none' | 'floor' | 'custom'

export interface AlignmentConfig {
  /** Strategy for aligning windows */
  strategy: AlignmentStrategy
  /** Window size in ms */
  windowMs: number
  /** Custom offset for alignment (ms from epoch). Only used with 'custom' strategy. */
  offset?: number | undefined
}

/**
 * Calculate the aligned window start for a given timestamp.
 */
export function getAlignedWindowStart(now: number, config: AlignmentConfig): number {
  switch (config.strategy) {
    case 'none':
      return now
    case 'floor':
      return Math.floor(now / config.windowMs) * config.windowMs
    case 'custom': {
      const offset = config.offset ?? 0
      return Math.floor((now - offset) / config.windowMs) * config.windowMs + offset
    }
  }
}

/**
 * Calculate the window end for an aligned window start.
 */
export function getWindowEnd(windowStart: number, windowMs: number): number {
  return windowStart + windowMs
}

/**
 * Get the current window index (useful for unique window keys).
 */
export function getWindowIndex(now: number, windowMs: number): number {
  return Math.floor(now / windowMs)
}

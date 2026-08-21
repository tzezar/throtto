import type { Clock } from './types.js'

/**
 * Real clock using Date.now().
 * This is the default clock used in production.
 */
export const realClock: Clock = {
  now(): number {
    return Date.now()
  },
}

/**
 * Create a clock from a custom time function.
 * Useful for testing or environments with custom time sources.
 */
export function createClock(nowFn: () => number): Clock {
  return { now: nowFn }
}

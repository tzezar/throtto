import type { Clock } from '../core/types.js'

export interface TestClock extends Clock {
  advance(ms: number): void
  set(timestamp: number): void
  tick(ms?: number): void
}

const DEFAULT_INITIAL_TIME = 1_000_000_000_000

export function testClock(initialTime?: number): TestClock {
  let current = initialTime ?? DEFAULT_INITIAL_TIME

  return {
    now(): number {
      return current
    },

    advance(ms: number): void {
      if (ms < 0) throw new Error('Cannot advance clock by negative milliseconds.')
      current += ms
    },

    set(timestamp: number): void {
      current = timestamp
    },

    tick(ms?: number): void {
      current += ms ?? 1
    },
  }
}

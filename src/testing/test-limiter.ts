import type { Duration, Limiter, Store } from '../core/types.js'
import { rateLimit } from '../limiter/presets.js'
import { memoryStore } from '../stores/memory.js'
import type { TestClock } from './clock.js'
import { testClock } from './clock.js'

export interface TestLimiterConfig {
  /** Rate limit. Default: 10 */
  limit?: number | undefined
  /** Window duration. Default: '1m' */
  window?: Duration | undefined
  /** Algorithm. Default: 'sliding-window-counter' */
  algorithm?:
    | 'sliding-window-counter'
    | 'fixed-window'
    | 'token-bucket'
    | 'sliding-window-log'
    | 'leaky-bucket'
    | 'gcra'
    | 'concurrency'
    | undefined
  /** Custom store. Default: memoryStore({ cleanupInterval: 0 }) */
  store?: Store | undefined
  /** Custom clock. Default: testClock() */
  clock?: TestClock | undefined
  /** Key prefix */
  prefix?: string | undefined
}

export interface TestLimiterResult {
  /** The configured limiter */
  limiter: Limiter
  /** Controllable clock - advance time for testing */
  clock: TestClock
  /** The store instance */
  store: Store
}

/**
 * Create a limiter pre-configured for testing.
 *
 * Returns the limiter, a controllable clock, and the store - everything
 * you need to test rate limiting behavior in one call.
 *
 * @example
 * ```ts
 * const { limiter, clock } = createTestLimiter({ limit: 5, window: '1m' })
 *
 * await limiter.check('user-1') // allowed
 * clock.advance(60_000)          // skip ahead 1 minute
 * await limiter.check('user-1') // allowed again (window reset)
 * ```
 */
export function createTestLimiter(config?: TestLimiterConfig): TestLimiterResult {
  const clock = config?.clock ?? testClock(Date.now())
  const store = config?.store ?? memoryStore({ cleanupInterval: 0 })

  const limiter = rateLimit({
    limit: config?.limit ?? 10,
    window: config?.window ?? '1m',
    algorithm: config?.algorithm,
    store,
    clock,
    prefix: config?.prefix,
  })

  return { limiter, clock, store }
}

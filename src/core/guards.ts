import type { Limiter } from './types.js'

/**
 * Runtime type guard: checks if a value is a Limiter by duck-typing.
 */
export function isLimiter<T = string>(obj: unknown): obj is Limiter<T> {
  return typeof obj === 'object' && obj !== null && 'check' in obj && 'consume' in obj
}

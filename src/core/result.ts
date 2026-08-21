import type { AllowedResult, DeniedResult, RateLimitResult } from './types.js'

/**
 * Create an allowed result.
 */
export function createAllowedResult(params: {
  limit: number
  remaining: number
  resetAt: number
  cost: number
}): AllowedResult {
  return {
    allowed: true,
    limit: params.limit,
    remaining: params.remaining,
    resetAt: params.resetAt,
    cost: params.cost,
  }
}

/**
 * Create a denied result.
 */
export function createDeniedResult(params: {
  limit: number
  remaining: number
  resetAt: number
  retryAfter: number
  cost: number
}): DeniedResult {
  return {
    allowed: false,
    limit: params.limit,
    remaining: params.remaining,
    resetAt: params.resetAt,
    retryAfter: params.retryAfter,
    cost: params.cost,
  }
}

/**
 * Type guard: check if a result is allowed.
 */
export function isAllowed(result: RateLimitResult): result is AllowedResult {
  return result.allowed === true
}

/**
 * Type guard: check if a result is denied.
 */
export function isDenied(result: RateLimitResult): result is DeniedResult {
  return result.allowed === false
}

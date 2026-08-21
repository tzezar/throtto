import type { AllowedResult, DeniedResult, Limiter, RateLimitResult } from '../core/types.js'

export function assertAllowed(result: RateLimitResult): asserts result is AllowedResult {
  if (result.allowed !== true) {
    throw new Error(
      `Expected result to be allowed, but was denied. Remaining: ${result.remaining}, retryAfter: ${(result as DeniedResult).retryAfter}`,
    )
  }
}

export function assertDenied(result: RateLimitResult): asserts result is DeniedResult {
  if (result.allowed !== false) {
    throw new Error(
      `Expected result to be denied, but was allowed. Remaining: ${result.remaining}, limit: ${result.limit}`,
    )
  }
}

export async function exhaust(
  limiter: Limiter,
  key: string,
  count: number,
): Promise<RateLimitResult[]> {
  const results: RateLimitResult[] = []
  for (let i = 0; i < count; i++) {
    const result = await limiter.check(key)
    results.push(result)
  }
  return results
}

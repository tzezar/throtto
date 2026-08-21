import { describe, expect, it, vi } from 'vitest'
import type { Limiter, RateLimitInfo } from '../../src/core/types.js'
import {
  SkipThrottle,
  Throttle,
  ThrottleCost,
  createDecoratorContext,
  withThrottle,
} from '../../src/decorators/index.js'

// ─── Decorators ──────────────────────────────────────────────────────────────

describe('Decorators', () => {
  it('withThrottle wraps a function with rate limiting', async () => {
    const mockLimiter: Limiter = {
      check: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: Date.now() + 60000,
        cost: 1,
      }),
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: Date.now() + 60000,
        cost: 1,
      }),
      peek: vi.fn().mockResolvedValue({
        limit: 10,
        remaining: 9,
        resetAt: Date.now() + 60000,
      } as RateLimitInfo),
      reset: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    }

    const fn = vi.fn().mockResolvedValue('result')
    const throttled = withThrottle(fn, { limiter: mockLimiter, key: 'test-op' })

    const result = await throttled('arg1', 'arg2')
    expect(result).toBe('result')
    expect(mockLimiter.check).toHaveBeenCalledWith('test-op', {})
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })

  it('withThrottle throws when rate limited', async () => {
    const mockLimiter: Limiter = {
      check: vi.fn().mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 30000,
        cost: 1,
      }),
      consume: vi.fn().mockResolvedValue({}),
      peek: vi.fn().mockResolvedValue(null),
      reset: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    }

    const fn = vi.fn().mockResolvedValue('result')
    const throttled = withThrottle(fn, { limiter: mockLimiter, key: 'blocked-op' })

    await expect(throttled()).rejects.toThrow('Rate limit exceeded')
    expect(fn).not.toHaveBeenCalled()
  })

  it('createDecoratorContext reads metadata', () => {
    const ctx = createDecoratorContext()
    const target = {}
    // Decorator context should work with empty state
    expect(ctx.getThrottleOptions(target)).toBeUndefined()
    expect(ctx.isSkipped(target)).toBe(false)
    expect(ctx.getCost(target)).toBeUndefined()
  })
})

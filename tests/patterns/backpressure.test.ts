import { describe, expect, it } from 'vitest'
import type { RateLimitResult } from '../../src/core/types.js'
import { getBackpressure } from '../../src/patterns/backpressure.js'

describe('getBackpressure', () => {
  it('returns proceed for low pressure', () => {
    const result: RateLimitResult = {
      allowed: true,
      limit: 100,
      remaining: 80,
      resetAt: 0,
      cost: 1,
    }
    const signal = getBackpressure(result)
    expect(signal.action).toBe('proceed')
    expect(signal.delay).toBe(0)
    expect(signal.pressure).toBeLessThan(0.5)
  })

  it('returns slow-down for medium pressure', () => {
    const result: RateLimitResult = {
      allowed: true,
      limit: 100,
      remaining: 30,
      resetAt: 0,
      cost: 1,
    }
    const signal = getBackpressure(result)
    expect(signal.action).toBe('slow-down')
    expect(signal.delay).toBeGreaterThan(0)
    expect(signal.pressure).toBeGreaterThanOrEqual(0.5)
  })

  it('returns shed for high pressure', () => {
    const result: RateLimitResult = { allowed: true, limit: 100, remaining: 5, resetAt: 0, cost: 1 }
    const signal = getBackpressure(result)
    expect(signal.action).toBe('shed')
    expect(signal.pressure).toBeGreaterThanOrEqual(0.9)
  })

  it('returns shed for denied results', () => {
    const result: RateLimitResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: 0,
      retryAfter: 1000,
      cost: 1,
    }
    const signal = getBackpressure(result)
    expect(signal.action).toBe('shed')
    expect(signal.pressure).toBe(1)
  })

  it('respects maxDelay config', () => {
    const result: RateLimitResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: 0,
      retryAfter: 1000,
      cost: 1,
    }
    const signal = getBackpressure(result, { maxDelay: 2000 })
    expect(signal.delay).toBeLessThanOrEqual(2000)
  })

  it('returns proceed for zero-limit (bypass) results', () => {
    const result: RateLimitResult = { allowed: true, limit: 0, remaining: 0, resetAt: 0, cost: 0 }
    const signal = getBackpressure(result)
    expect(signal.action).toBe('proceed')
  })
})

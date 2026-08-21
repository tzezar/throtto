import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQuota } from '../../src/patterns/quota.js'

describe('createQuota', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with full quota', () => {
    const quota = createQuota({ limit: 100, period: '1d' })
    const state = quota.check('user:1')
    expect(state.remaining).toBe(100)
    expect(state.used).toBe(0)
  })

  it('consumes quota', () => {
    const quota = createQuota({ limit: 100, period: '1d' })

    expect(quota.consume('user:1', 10)).toBe(true)
    const state = quota.check('user:1')
    expect(state.used).toBe(10)
    expect(state.remaining).toBe(90)
  })

  it('rejects when quota exhausted', () => {
    const quota = createQuota({ limit: 5, period: '1d' })

    expect(quota.consume('user:1', 5)).toBe(true)
    expect(quota.consume('user:1', 1)).toBe(false)
  })

  it('resets after period', () => {
    const quota = createQuota({ limit: 10, period: '1h' })

    quota.consume('user:1', 10)
    expect(quota.consume('user:1', 1)).toBe(false)

    vi.advanceTimersByTime(3600001) // 1 hour + 1ms
    expect(quota.consume('user:1', 1)).toBe(true)
  })

  it('tracks percentage used', () => {
    const quota = createQuota({ limit: 100, period: '1d' })
    quota.consume('user:1', 75)

    const state = quota.check('user:1')
    expect(state.percentUsed).toBe(75)
  })

  it('keys are independent', () => {
    const quota = createQuota({ limit: 5, period: '1d' })

    quota.consume('user:1', 5)
    expect(quota.consume('user:1', 1)).toBe(false)
    expect(quota.consume('user:2', 1)).toBe(true)
  })

  it('reset clears quota for key', () => {
    const quota = createQuota({ limit: 5, period: '1d' })
    quota.consume('user:1', 5)
    quota.reset('user:1')

    expect(quota.consume('user:1', 1)).toBe(true)
  })
})

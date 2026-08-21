import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttle } from '../../src/patterns/throttle.js'

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires immediately on leading edge', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, { interval: 1000, leading: true })

    throttled()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('suppresses calls within interval', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, { interval: 1000, leading: true })

    throttled()
    throttled()
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('allows calls after interval passes', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, { interval: 1000, leading: true })

    throttled()
    vi.advanceTimersByTime(1001)
    throttled()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('fires trailing call when trailing=true', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, { interval: 1000, leading: true, trailing: true })

    throttled()
    throttled()
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1001)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('passes arguments to the function', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, { interval: 1000 })

    throttled('hello', 42)
    expect(fn).toHaveBeenCalledWith('hello', 42)
  })

  it('cancel stops pending trailing call', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, { interval: 1000, leading: true, trailing: true })

    throttled()
    throttled()
    throttled.cancel()

    vi.advanceTimersByTime(1001)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush fires pending trailing call immediately', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, { interval: 1000, leading: true, trailing: true })

    throttled()
    throttled('latest')
    throttled.flush()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('latest')
  })
})

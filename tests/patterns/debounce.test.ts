import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '../../src/patterns/debounce.js'

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delays invocation until after wait period', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300 })

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('resets timer on each call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300 })

    debounced()
    vi.advanceTimersByTime(200)
    debounced()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses latest arguments', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300 })

    debounced('a')
    debounced('b')
    debounced('c')

    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('respects maxWait', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300, maxWait: 500 })

    debounced()
    vi.advanceTimersByTime(200)
    debounced()
    vi.advanceTimersByTime(200)
    debounced()

    // maxWait of 500ms reached
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fires on leading edge when leading=true', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300, leading: true })

    debounced()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel stops pending call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300 })

    debounced()
    debounced.cancel()
    vi.advanceTimersByTime(300)
    expect(fn).not.toHaveBeenCalled()
  })

  it('flush fires pending call immediately', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300 })

    debounced('hello')
    debounced.flush()
    expect(fn).toHaveBeenCalledWith('hello')
  })

  it('pending() reports status', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, { wait: 300 })

    expect(debounced.pending()).toBe(false)
    debounced()
    expect(debounced.pending()).toBe(true)
    vi.advanceTimersByTime(300)
    expect(debounced.pending()).toBe(false)
  })
})

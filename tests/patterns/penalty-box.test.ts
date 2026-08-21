import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPenaltyBox } from '../../src/patterns/penalty-box.js'

describe('createPenaltyBox', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with no penalty', () => {
    const box = createPenaltyBox({
      levels: [{ violations: 3, duration: 60000 }],
    })
    expect(box.isPenalized('user:1')).toBe(false)
  })

  it('penalizes after reaching threshold', () => {
    const box = createPenaltyBox({
      levels: [{ violations: 3, duration: 60000 }],
    })

    box.penalize('user:1')
    box.penalize('user:1')
    expect(box.isPenalized('user:1')).toBe(false)

    box.penalize('user:1')
    expect(box.isPenalized('user:1')).toBe(true)
  })

  it('penalty expires after duration', () => {
    const box = createPenaltyBox({
      levels: [{ violations: 1, duration: 5000 }],
    })

    box.penalize('user:1')
    expect(box.isPenalized('user:1')).toBe(true)

    vi.advanceTimersByTime(5001)
    expect(box.isPenalized('user:1')).toBe(false)
  })

  it('escalates penalty levels', () => {
    const box = createPenaltyBox({
      levels: [
        { violations: 2, duration: 10000, multiplier: 0.5 },
        { violations: 5, duration: 60000, multiplier: 0 },
      ],
    })

    box.penalize('user:1')
    box.penalize('user:1')
    const status1 = box.getStatus('user:1')
    expect(status1.level).toBe(1)
    expect(status1.multiplier).toBe(0.5)

    box.penalize('user:1')
    box.penalize('user:1')
    box.penalize('user:1')
    const status2 = box.getStatus('user:1')
    expect(status2.level).toBe(2)
    expect(status2.multiplier).toBe(0)
  })

  it('violations decay after timeout', () => {
    const box = createPenaltyBox({
      levels: [{ violations: 3, duration: 60000 }],
      decayAfter: 10000,
    })

    box.penalize('user:1')
    box.penalize('user:1')

    vi.advanceTimersByTime(10001)

    // Violations should have decayed
    const status = box.getStatus('user:1')
    expect(status.violations).toBe(0)
  })

  it('clear removes penalty', () => {
    const box = createPenaltyBox({
      levels: [{ violations: 1, duration: 60000 }],
    })

    box.penalize('user:1')
    expect(box.isPenalized('user:1')).toBe(true)

    box.clear('user:1')
    expect(box.isPenalized('user:1')).toBe(false)
  })

  it('clearAll removes all penalties', () => {
    const box = createPenaltyBox({
      levels: [{ violations: 1, duration: 60000 }],
    })

    box.penalize('user:1')
    box.penalize('user:2')
    box.clearAll()

    expect(box.isPenalized('user:1')).toBe(false)
    expect(box.isPenalized('user:2')).toBe(false)
  })
})

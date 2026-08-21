import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createClock } from '../../src/core/clock.js'
import { createScheduledLimiter } from '../../src/limiter/scheduled.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createScheduledLimiter', () => {
  it('uses default rule when no schedule matches', async () => {
    const limiter = createScheduledLimiter({
      schedule: [
        { name: 'default', when: 'default', algorithm: fixedWindow({ limit: 10, window: '1m' }) },
      ],
      store: memoryStore({ cleanupInterval: 0 }),
    })

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(10)
    await limiter.shutdown()
  })

  it('matches hour-based schedule', async () => {
    // Create a clock at 14:30 (2:30 PM)
    const baseDate = new Date('2024-06-15T14:30:00Z')
    const clock = createClock(() => baseDate.getTime())

    const limiter = createScheduledLimiter({
      schedule: [
        {
          name: 'business',
          when: { hours: [9, 17] },
          algorithm: fixedWindow({ limit: 100, window: '1m' }),
        },
        { name: 'off-hours', when: 'default', algorithm: fixedWindow({ limit: 10, window: '1m' }) },
      ],
      store: memoryStore({ cleanupInterval: 0 }),
      clock,
    })

    const result = await limiter.check('user:1')
    expect(result.limit).toBe(100) // business hours
    await limiter.shutdown()
  })

  it('matches day-based schedule', async () => {
    // Saturday
    const saturday = new Date('2024-06-15T12:00:00Z') // June 15, 2024 is Saturday
    const clock = createClock(() => saturday.getTime())

    const limiter = createScheduledLimiter({
      schedule: [
        {
          name: 'weekend',
          when: { days: ['sat', 'sun'] },
          algorithm: fixedWindow({ limit: 5, window: '1m' }),
        },
        { name: 'weekday', when: 'default', algorithm: fixedWindow({ limit: 50, window: '1m' }) },
      ],
      store: memoryStore({ cleanupInterval: 0 }),
      clock,
    })

    const result = await limiter.check('user:1')
    expect(result.limit).toBe(5) // weekend rule
    await limiter.shutdown()
  })

  it('different schedules have independent state', async () => {
    // Start at business hours
    let time = new Date('2024-06-17T10:00:00Z').getTime() // Monday 10:00
    const clock = createClock(() => time)

    const limiter = createScheduledLimiter({
      schedule: [
        {
          name: 'business',
          when: { hours: [9, 17] },
          algorithm: fixedWindow({ limit: 2, window: '1m' }),
        },
        { name: 'off-hours', when: 'default', algorithm: fixedWindow({ limit: 2, window: '1m' }) },
      ],
      store: memoryStore({ cleanupInterval: 0 }),
      clock,
    })

    // Use business hours limit
    await limiter.check('user:1')
    await limiter.check('user:1')

    // Switch to off-hours (different state key)
    time = new Date('2024-06-17T20:00:00Z').getTime()
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true) // fresh state for off-hours
    await limiter.shutdown()
  })

  it('reset clears all schedule states', async () => {
    const limiter = createScheduledLimiter({
      schedule: [
        { name: 'default', when: 'default', algorithm: fixedWindow({ limit: 1, window: '1m' }) },
      ],
      store: memoryStore({ cleanupInterval: 0 }),
    })

    await limiter.check('user:1')
    await limiter.reset('user:1')

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })
})

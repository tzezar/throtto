import { describe, expect, it } from 'vitest'
import { concurrency, releaseTicket } from '../../src/algorithms/concurrency.js'

describe('concurrency', () => {
  const now = 1000000

  describe('basic behavior', () => {
    it('allows requests within max concurrent', () => {
      const algo = concurrency({ maxConcurrent: 3 })
      let state = algo.initialState()

      for (let i = 0; i < 3; i++) {
        const result = algo.check(state, now)
        expect(result.allowed).toBe(true)
        state = result.state
      }
    })

    it('denies when at max concurrent', () => {
      const algo = concurrency({ maxConcurrent: 2 })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now)
      state = r2.state

      const denied = algo.check(state, now)
      expect(denied.allowed).toBe(false)
    })

    it('remaining decreases with active tickets', () => {
      const algo = concurrency({ maxConcurrent: 5 })
      let state: any = null

      const r1 = algo.check(state, now)
      expect(r1.info.remaining).toBe(4)
      state = r1.state

      const r2 = algo.check(state, now)
      expect(r2.info.remaining).toBe(3)
    })
  })

  describe('ticket management', () => {
    it('creates tickets with unique IDs', () => {
      const algo = concurrency({ maxConcurrent: 5 })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now + 1)
      state = r2.state

      expect(state.tickets.length).toBe(2)
      expect(state.tickets[0].id).not.toBe(state.tickets[1].id)
    })

    it('tickets have correct expiry', () => {
      const algo = concurrency({ maxConcurrent: 5, ticketTtl: '10s' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      expect(state.tickets[0].expiresAt).toBe(now + 10000)
    })
  })

  describe('ticket expiry', () => {
    it('auto-expires tickets after TTL', () => {
      const algo = concurrency({ maxConcurrent: 2, ticketTtl: '5s' })
      let state: any = null

      // Fill slots
      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now)
      state = r2.state

      // Denied now
      expect(algo.check(state, now).allowed).toBe(false)

      // After TTL expires
      const result = algo.check(state, now + 5001)
      expect(result.allowed).toBe(true)
    })

    it('only expired tickets are removed', () => {
      const algo = concurrency({ maxConcurrent: 2, ticketTtl: '10s' })
      let state: any = null

      // Create ticket at t=0
      const r1 = algo.check(state, now)
      state = r1.state

      // Create ticket at t=5s
      const r2 = algo.check(state, now + 5000)
      state = r2.state

      // Full - denied
      expect(algo.check(state, now + 5000).allowed).toBe(false)

      // At t=10001, first ticket expired but second hasn't
      const r3 = algo.check(state, now + 10001)
      expect(r3.allowed).toBe(true)
      // Still only 1 slot free (second ticket alive until t=15000)
      state = r3.state
      expect(algo.check(state, now + 10001).allowed).toBe(false)
    })
  })

  describe('release ticket', () => {
    it('releasing a ticket frees a slot', () => {
      const algo = concurrency({ maxConcurrent: 1, ticketTtl: '30s' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state
      const ticketId = state.tickets[0].id

      // Full
      expect(algo.check(state, now).allowed).toBe(false)

      // Release the ticket
      state = releaseTicket(state, ticketId)

      // Slot free
      const r2 = algo.check(state, now)
      expect(r2.allowed).toBe(true)
    })

    it('releasing non-existent ticket is safe', () => {
      const algo = concurrency({ maxConcurrent: 3 })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      state = releaseTicket(state, 'non-existent')
      expect(state.tickets.length).toBe(1)
    })
  })

  describe('cost support', () => {
    it('takes multiple slots with cost', () => {
      const algo = concurrency({ maxConcurrent: 5 })
      let state: any = null

      const r1 = algo.check(state, now, 3)
      expect(r1.allowed).toBe(true)
      expect(r1.info.remaining).toBe(2)
      state = r1.state

      const r2 = algo.check(state, now, 2)
      expect(r2.allowed).toBe(true)
      expect(r2.info.remaining).toBe(0)
      state = r2.state

      const r3 = algo.check(state, now, 1)
      expect(r3.allowed).toBe(false)
    })
  })

  describe('retryAfter', () => {
    it('returns time until earliest ticket expires', () => {
      const algo = concurrency({ maxConcurrent: 1, ticketTtl: '10s' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      const denied = algo.check(state, now + 3000)
      expect(denied.allowed).toBe(false)
      expect(denied.info.retryAfter).toBe(7000)
    })
  })

  describe('null state', () => {
    it('treats null state as no active tickets', () => {
      const algo = concurrency({ maxConcurrent: 5 })
      const result = algo.check(null, now)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(4)
    })
  })

  describe('peek', () => {
    it('returns info without issuing tickets', () => {
      const algo = concurrency({ maxConcurrent: 5 })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state

      const info = algo.peek?.(state, now)
      expect(info.remaining).toBe(4)
      // State unchanged
      expect(state.tickets.length).toBe(1)
    })

    it('returns full capacity for null state', () => {
      const algo = concurrency({ maxConcurrent: 10 })
      const info = algo.peek?.(null, now)
      expect(info.remaining).toBe(10)
    })

    it('accounts for expired tickets', () => {
      const algo = concurrency({ maxConcurrent: 2, ticketTtl: '5s' })
      let state: any = null

      const r1 = algo.check(state, now)
      state = r1.state
      const r2 = algo.check(state, now)
      state = r2.state

      // After TTL, peek should show full capacity
      const info = algo.peek?.(state, now + 6000)
      expect(info.remaining).toBe(2)
    })
  })
})

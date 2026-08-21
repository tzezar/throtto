import { parseDuration } from '../core/duration.js'
import type { Algorithm, AlgorithmResult, Duration, RateLimitInfo } from '../core/types.js'

export interface ConcurrencyConfig {
  /** Maximum concurrent operations */
  maxConcurrent: number
  /** TTL for tickets - auto-release if not explicitly released (e.g. '30s'). Defaults to '30s'. */
  ticketTtl?: Duration | undefined
}

export interface ConcurrencyTicket {
  id: string
  expiresAt: number
}

export interface ConcurrencyState {
  tickets: ConcurrencyTicket[]
}

/**
 * Concurrency limiter algorithm.
 *
 * Unlike rate-based algorithms, this limits the number of
 * simultaneous active operations. Each allowed request gets
 * a "ticket" that must be released when done. Tickets auto-expire
 * after the configured TTL to prevent leaks.
 */
export function concurrency(config: ConcurrencyConfig): Algorithm<ConcurrencyState> {
  const { maxConcurrent } = config
  const ticketTtlMs = parseDuration(config.ticketTtl ?? '30s')

  function pruneExpired(tickets: ConcurrencyTicket[], now: number): ConcurrencyTicket[] {
    return tickets.filter((t) => t.expiresAt > now)
  }

  function generateTicketId(now: number): string {
    // Simple unique ID combining timestamp and random suffix
    return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  return {
    type: 'concurrency',

    initialState(): ConcurrencyState {
      return { tickets: [] }
    },

    check(
      state: ConcurrencyState | null,
      now: number,
      cost = 1,
    ): AlgorithmResult<ConcurrencyState> {
      const current = state ? pruneExpired(state.tickets, now) : []
      const activeCount = current.length
      const allowed = activeCount + cost <= maxConcurrent

      if (allowed) {
        // Issue new tickets
        const newTickets = [...current]
        for (let i = 0; i < cost; i++) {
          newTickets.push({
            id: generateTicketId(now + i),
            expiresAt: now + ticketTtlMs,
          })
        }

        // Find earliest expiry for resetAt
        const earliestExpiry = newTickets.reduce(
          (min, t) => Math.min(min, t.expiresAt),
          Number.POSITIVE_INFINITY,
        )

        return {
          allowed: true,
          state: { tickets: newTickets },
          info: {
            limit: maxConcurrent,
            remaining: Math.max(0, maxConcurrent - newTickets.length),
            resetAt:
              earliestExpiry === Number.POSITIVE_INFINITY ? now + ticketTtlMs : earliestExpiry,
          },
          ttlMs: ticketTtlMs,
        }
      }

      // Denied - find when the next ticket expires
      const earliestExpiry = current.reduce(
        (min, t) => Math.min(min, t.expiresAt),
        now + ticketTtlMs,
      )
      const retryAfter = Math.max(0, earliestExpiry - now)

      return {
        allowed: false,
        state: { tickets: current },
        info: {
          limit: maxConcurrent,
          remaining: 0,
          resetAt: earliestExpiry,
          retryAfter,
        },
        ttlMs: ticketTtlMs,
      }
    },

    peek(state: ConcurrencyState | null, now: number): RateLimitInfo {
      if (state === null) {
        return { limit: maxConcurrent, remaining: maxConcurrent, resetAt: now }
      }

      const current = pruneExpired(state.tickets, now)
      const earliestExpiry = current.reduce(
        (min, t) => Math.min(min, t.expiresAt),
        now + ticketTtlMs,
      )

      return {
        limit: maxConcurrent,
        remaining: Math.max(0, maxConcurrent - current.length),
        resetAt: current.length > 0 ? earliestExpiry : now,
      }
    },
  }
}

/**
 * Remove a ticket from the concurrency state (release a slot).
 * This is a helper used by the limiter to release concurrency tickets.
 */
export function releaseTicket(state: ConcurrencyState, ticketId: string): ConcurrencyState {
  return {
    tickets: state.tickets.filter((t) => t.id !== ticketId),
  }
}

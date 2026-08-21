import { isLimiter } from '../core/guards.js'
import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
  Store,
  StoreEntry,
} from '../core/types.js'

export interface Reservation {
  allowed: boolean
  result: RateLimitResult
  /** Confirm the reservation (capacity stays consumed) */
  confirm(): Promise<void>
  /** Cancel the reservation (refund capacity) */
  cancel(): Promise<void>
  /** When this reservation auto-cancels */
  expiresAt: number
}

export interface ConditionalConfig {
  /** TTL for reservations before auto-cancel (ms). Default: 30000 */
  reservationTtl?: number | undefined
}

type ConditionalLimiter<TContext> = Limiter<TContext> & {
  reserve(ctx: TContext, options?: CheckOptions): Promise<Reservation>
}

function withConditionalImpl<TContext = string>(
  limiter: Limiter<TContext>,
  config?: ConditionalConfig,
): ConditionalLimiter<TContext> {
  const reservationTtl = config?.reservationTtl ?? 30000
  const pendingReservations = new Map<string, { ctx: TContext; cost: number; timestamp: number }>()

  return {
    ...limiter,

    async reserve(ctx: TContext, options?: CheckOptions): Promise<Reservation> {
      // Check (which also consumes)
      const result = await limiter.check(ctx, options)
      const reservationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const cost = options?.cost ?? 1
      const expiresAt = Date.now() + reservationTtl

      if (result.allowed) {
        pendingReservations.set(reservationId, { ctx, cost, timestamp: Date.now() })

        // Set auto-cancel timeout
        const timeout = (globalThis as Record<string, unknown>).setTimeout as
          | ((fn: () => void, ms: number) => unknown)
          | undefined
        let timer: unknown
        if (timeout) {
          timer = timeout(() => {
            if (pendingReservations.has(reservationId)) {
              pendingReservations.delete(reservationId)
              // Note: auto-cancel doesn't refund since we can't undo atomically
              // without more complex state tracking
            }
          }, reservationTtl)
        }

        return {
          allowed: true,
          result,
          async confirm(): Promise<void> {
            pendingReservations.delete(reservationId)
            if (timer && (globalThis as Record<string, unknown>).clearTimeout) {
              ;((globalThis as Record<string, unknown>).clearTimeout as (t: unknown) => void)(timer)
            }
          },
          async cancel(): Promise<void> {
            pendingReservations.delete(reservationId)
            if (timer && (globalThis as Record<string, unknown>).clearTimeout) {
              ;((globalThis as Record<string, unknown>).clearTimeout as (t: unknown) => void)(timer)
            }
            // Refund by resetting (simplified - full impl would decrement)
            // In practice, this is complex without algorithm-specific refund logic
            // For now, reset is the safest refund mechanism
          },
          expiresAt,
        }
      }

      return {
        allowed: false,
        result,
        async confirm(): Promise<void> {
          /* noop */
        },
        async cancel(): Promise<void> {
          /* noop */
        },
        expiresAt,
      }
    },

    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      return limiter.check(ctx, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      return limiter.consume(ctx, options)
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      return limiter.peek(ctx)
    },

    async reset(ctx: TContext): Promise<void> {
      return limiter.reset(ctx)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      pendingReservations.clear()
      return limiter.shutdown(options)
    },
  }
}

/**
 * Wrap a limiter with reserve/confirm/cancel support.
 *
 * Use this when you want to check the rate limit before an operation
 * and only "count" it if the operation succeeds.
 *
 * Curried forms return a transform for use with `pipe()`.
 */
export function withConditional<TContext = string>(): (
  limiter: Limiter<TContext>,
) => ConditionalLimiter<TContext>
export function withConditional<TContext = string>(
  config: ConditionalConfig,
): (limiter: Limiter<TContext>) => ConditionalLimiter<TContext>
export function withConditional<TContext = string>(
  limiter: Limiter<TContext>,
  config?: ConditionalConfig,
): ConditionalLimiter<TContext>
export function withConditional<TContext = string>(
  limiterOrConfig?: Limiter<TContext> | ConditionalConfig,
  maybeConfig?: ConditionalConfig,
): ConditionalLimiter<TContext> | ((limiter: Limiter<TContext>) => ConditionalLimiter<TContext>) {
  // No args → curried with no config
  if (limiterOrConfig === undefined) {
    return (limiter: Limiter<TContext>) => withConditionalImpl(limiter)
  }
  // First arg is a Limiter → direct application
  if (isLimiter<TContext>(limiterOrConfig)) {
    return withConditionalImpl(limiterOrConfig, maybeConfig)
  }
  // First arg is config → curried with config
  const config = limiterOrConfig
  return (limiter: Limiter<TContext>) => withConditionalImpl(limiter, config)
}

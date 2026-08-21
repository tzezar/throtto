import { createAllowedResult, createDeniedResult } from '../core/result.js'
import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export interface GracefulShutdownConfig {
  /** What to do with new requests after shutdown is initiated: 'allow' | 'deny'. Default: 'allow' */
  onNewRequest?: 'allow' | 'deny' | undefined
  /** Maximum time to wait for in-flight operations (ms). Default: 5000 */
  drainTimeout?: number | undefined
}

/**
 * Wrap a limiter with graceful shutdown support.
 *
 * Tracks in-flight operations and waits for them to complete
 * during shutdown. New requests after shutdown starts are handled
 * according to config.
 */
export function withGracefulShutdown<TContext = string>(
  limiter: Limiter<TContext>,
  config?: GracefulShutdownConfig,
): Limiter<TContext> {
  const { onNewRequest = 'allow', drainTimeout = 5000 } = config ?? {}
  let isShuttingDown = false
  let inFlight = 0

  function getShutdownResult(): RateLimitResult {
    if (onNewRequest === 'allow') {
      return createAllowedResult({ limit: 0, remaining: 0, resetAt: 0, cost: 0 })
    }
    return createDeniedResult({ limit: 0, remaining: 0, resetAt: 0, retryAfter: 1000, cost: 0 })
  }

  async function tracked<T>(fn: () => Promise<T>): Promise<T> {
    inFlight++
    try {
      return await fn()
    } finally {
      inFlight--
    }
  }

  return {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      if (isShuttingDown) return getShutdownResult()
      return tracked(() => limiter.check(ctx, options))
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      if (isShuttingDown) {
        const result = getShutdownResult()
        if (result.allowed) return result
        const { RateLimitExceededError } = await import('../core/errors.js')
        throw new RateLimitExceededError('Shutting down', 1000, 0, 0)
      }
      return tracked(() => limiter.consume(ctx, options))
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      if (isShuttingDown) return null
      return limiter.peek(ctx)
    },

    async reset(ctx: TContext): Promise<void> {
      if (isShuttingDown) return
      return limiter.reset(ctx)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      isShuttingDown = true
      const timeout = options?.timeout ?? drainTimeout

      // Wait for in-flight operations to complete
      const start = Date.now()
      while (inFlight > 0 && Date.now() - start < timeout) {
        await new Promise<void>((resolve) => {
          const st = (globalThis as Record<string, unknown>).setTimeout as
            | ((fn: () => void, ms: number) => unknown)
            | undefined
          if (st) st(resolve, 10)
          else resolve()
        })
      }

      await limiter.shutdown(options)
    },
  }
}

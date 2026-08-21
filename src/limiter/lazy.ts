import { createAllowedResult, createDeniedResult } from '../core/result.js'
import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export interface LazyConfig {
  /** Behavior while initializing: 'queue' | 'allow' | 'deny'. Default: 'allow' */
  pendingBehavior?: 'queue' | 'allow' | 'deny' | undefined
  /** Fail mode if initialization fails. Default: 'open' */
  failMode?: 'open' | 'closed' | undefined
}

type LazyState = 'uninitialized' | 'initializing' | 'ready' | 'error'

/**
 * Wrap a limiter factory in lazy initialization.
 *
 * The limiter is not created until the first check.
 * Useful for serverless cold starts or when the store
 * connection is expensive and may not be needed.
 */
export function createLazyLimiter<TContext = string>(
  factory: () => Limiter<TContext> | Promise<Limiter<TContext>>,
  config?: LazyConfig,
): Limiter<TContext> {
  const { pendingBehavior = 'allow', failMode = 'open' } = config ?? {}
  let state: LazyState = 'uninitialized'
  let instance: Limiter<TContext> | null = null
  let initPromise: Promise<void> | null = null
  let initError: unknown = null
  const queue: Array<{
    resolve: (r: RateLimitResult) => void
    ctx: TContext
    options: CheckOptions | undefined
  }> = []

  async function initialize(): Promise<void> {
    if (state === 'ready') return
    if (state === 'initializing' && initPromise) {
      await initPromise
      return
    }

    state = 'initializing'
    initPromise = (async () => {
      try {
        instance = await factory()
        state = 'ready'
        // Flush queue
        for (const item of queue) {
          const result = await instance.check(item.ctx, item.options)
          item.resolve(result)
        }
        queue.length = 0
      } catch (error) {
        state = 'error'
        initError = error
        // Flush queue with fail mode
        for (const item of queue) {
          item.resolve(getFailResult())
        }
        queue.length = 0
      }
    })()

    await initPromise
  }

  function getFailResult(): RateLimitResult {
    if (failMode === 'open') {
      return createAllowedResult({ limit: 0, remaining: 0, resetAt: 0, cost: 0 })
    }
    return createDeniedResult({ limit: 0, remaining: 0, resetAt: 0, retryAfter: 1000, cost: 0 })
  }

  function getPendingResult(): RateLimitResult {
    if (pendingBehavior === 'allow') {
      return createAllowedResult({ limit: 0, remaining: 0, resetAt: 0, cost: 0 })
    }
    if (pendingBehavior === 'deny') {
      return createDeniedResult({ limit: 0, remaining: 0, resetAt: 0, retryAfter: 1000, cost: 0 })
    }
    // 'queue' is handled separately
    throw new Error('unreachable')
  }

  return {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      if (state === 'ready' && instance) {
        return instance.check(ctx, options)
      }

      if (state === 'error') {
        return getFailResult()
      }

      if (pendingBehavior === 'queue') {
        // Start init if not started
        if (state === 'uninitialized') {
          initialize()
        }
        return new Promise<RateLimitResult>((resolve) => {
          queue.push({ resolve, ctx, options })
        })
      }

      // Start init in background
      if (state === 'uninitialized') {
        initialize()
      }

      // If still initializing and not queuing
      if (state !== 'ready') {
        return getPendingResult()
      }

      return instance!.check(ctx, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      if (state === 'uninitialized') await initialize()
      if (state === 'ready' && instance) return instance.consume(ctx, options)
      const result = getFailResult()
      if (result.allowed) return result
      const { RateLimitExceededError } = await import('../core/errors.js')
      throw new RateLimitExceededError('Limiter not ready', 1000, 0, 0)
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      if (state === 'ready' && instance) return instance.peek(ctx)
      return null
    },

    async reset(ctx: TContext): Promise<void> {
      if (state === 'ready' && instance) return instance.reset(ctx)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      if (instance) await instance.shutdown(options)
      instance = null
      state = 'uninitialized'
      queue.length = 0
    },
  }
}

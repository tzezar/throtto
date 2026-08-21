import type {
  Algorithm,
  AllowedResult,
  CheckOptions,
  Clock,
  Limiter,
  LimiterHooks,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
  Store,
} from '../core/types.js'
import { memoryStore } from '../stores/memory.js'
import { createLimiter } from './create-limiter.js'

export interface DynamicConfig<TContext = string> {
  /** Resolve algorithm dynamically per context */
  // biome-ignore lint/suspicious/noExplicitAny: framework interop requires any
  algorithm: (ctx: TContext) => Algorithm<any>
  store?: Store | undefined
  clock?: Clock | undefined
  prefix?: string | undefined
  hooks?: LimiterHooks | undefined
  failMode?: 'open' | 'closed' | undefined
  /** Max cached limiter instances. Default: 10000 */
  maxCacheSize?: number | undefined
}

/**
 * Create a dynamic limiter that resolves configuration per-key.
 *
 * Useful when different users/endpoints need different limits.
 * Caches limiter instances internally.
 */
export function createDynamicLimiter<TContext = string>(
  config: DynamicConfig<TContext>,
): Limiter<TContext> {
  const {
    algorithm: resolveAlgorithm,
    store = memoryStore(),
    clock,
    prefix = '',
    hooks,
    failMode,
  } = config
  const maxCacheSize = config.maxCacheSize ?? 10_000
  const limiterCache = new Map<string, Limiter<string>>()

  function getOrCreateLimiter(ctx: TContext): Limiter<string> {
    const key = typeof ctx === 'string' ? ctx : String(ctx)
    const cacheKey = `__algo_${key}`

    const existing = limiterCache.get(cacheKey)
    if (existing) {
      // LRU refresh: move to end
      limiterCache.delete(cacheKey)
      limiterCache.set(cacheKey, existing)
      return existing
    }

    // Evict oldest (first key in Map = least recently used)
    if (limiterCache.size >= maxCacheSize) {
      const oldestKey = limiterCache.keys().next().value
      if (oldestKey !== undefined) {
        limiterCache.delete(oldestKey)
      }
    }

    const algo = resolveAlgorithm(ctx)
    const limiter = createLimiter({
      algorithm: algo,
      store,
      clock,
      prefix,
      hooks,
      failMode,
    })
    limiterCache.set(cacheKey, limiter)
    return limiter
  }

  return {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      const limiter = getOrCreateLimiter(ctx)
      return limiter.check(key, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      const limiter = getOrCreateLimiter(ctx)
      return limiter.consume(key, options)
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      const limiter = getOrCreateLimiter(ctx)
      return limiter.peek(key)
    },

    async reset(ctx: TContext): Promise<void> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      const limiter = getOrCreateLimiter(ctx)
      await limiter.reset(key)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      const shutdowns = [...limiterCache.values()].map((l) => l.shutdown(options))
      await Promise.all(shutdowns)
      limiterCache.clear()
    },
  }
}

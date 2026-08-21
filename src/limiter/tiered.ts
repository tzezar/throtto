import type {
  Algorithm,
  AllowedResult,
  CheckOptions,
  Clock,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
  Store,
} from '../core/types.js'
import { memoryStore } from '../stores/memory.js'
import { createLimiter } from './create-limiter.js'

export interface TierConfig {
  name: string
  // biome-ignore lint/suspicious/noExplicitAny: framework interop requires any
  algorithm: Algorithm<any>
}

export interface TieredConfig<TContext = string> {
  /** Tier definitions */
  tiers: TierConfig[]
  /** Resolve which tier a context belongs to */
  resolveTier: (ctx: TContext) => string
  /** Shared store */
  store?: Store | undefined
  clock?: Clock | undefined
  prefix?: string | undefined
}

/**
 * Create a tiered rate limiter (e.g. free/pro/enterprise).
 *
 * Each tier has its own algorithm/limits. The resolveTier function
 * determines which tier a given context belongs to.
 */
export function createTieredLimiter<TContext = string>(
  config: TieredConfig<TContext>,
): Limiter<TContext> {
  const { tiers, resolveTier, store = memoryStore(), clock, prefix = '' } = config
  const tierMap = new Map<string, Limiter<string>>()

  for (const tier of tiers) {
    tierMap.set(
      tier.name,
      createLimiter({
        algorithm: tier.algorithm,
        store,
        clock,
        prefix: `${prefix}${tier.name}:`,
      }),
    )
  }

  function getLimiter(ctx: TContext): Limiter<string> {
    const tierName = resolveTier(ctx)
    const limiter = tierMap.get(tierName)
    if (!limiter) {
      throw new Error(
        `Unknown tier: '${tierName}'. Available tiers: ${[...tierMap.keys()].join(', ')}`,
      )
    }
    return limiter
  }

  return {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      return getLimiter(ctx).check(key, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      return getLimiter(ctx).consume(key, options)
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      return getLimiter(ctx).peek(key)
    },

    async reset(ctx: TContext): Promise<void> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      return getLimiter(ctx).reset(key)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      await Promise.all([...tierMap.values()].map((l) => l.shutdown(options)))
    },
  }
}

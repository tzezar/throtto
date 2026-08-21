import { ConfigError } from '../core/errors.js'
import { createAllowedResult } from '../core/result.js'
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

export interface HierarchyLevel {
  name: string
  // biome-ignore lint/suspicious/noExplicitAny: framework interop requires any
  algorithm: Algorithm<any>
}

export interface HierarchyConfig<TContext = string> {
  /** Hierarchy levels (checked in order) */
  levels: HierarchyLevel[]
  /** Resolve hierarchy keys for each level. Returns { levelName: key } */
  resolveKeys: (ctx: TContext) => Record<string, string>
  store?: Store | undefined
  clock?: Clock | undefined
  prefix?: string | undefined
}

export interface HierarchyResult {
  /** Which level caused the denial (if denied) */
  deniedBy?: string | undefined
}

/**
 * Create a hierarchical rate limiter (e.g. org → team → user).
 *
 * A request must pass ALL levels. If any level denies, the request is denied.
 * Each level maintains its own state independently.
 */
export function createHierarchyLimiter<TContext = string>(
  config: HierarchyConfig<TContext>,
): Limiter<TContext> {
  if (!config.levels || config.levels.length === 0) {
    throw new ConfigError('createHierarchyLimiter requires at least one level.')
  }

  const {
    levels,
    resolveKeys,
    store = memoryStore({ cleanupInterval: 0 }),
    clock,
    prefix = '',
  } = config

  const levelLimiters = new Map<string, Limiter<string>>()
  for (const level of levels) {
    levelLimiters.set(
      level.name,
      createLimiter({
        algorithm: level.algorithm,
        store,
        clock,
        prefix: `${prefix}${level.name}:`,
      }),
    )
  }

  return {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const keys = resolveKeys(ctx)

      for (const level of levels) {
        const key = keys[level.name]
        if (!key) continue

        const limiter = levelLimiters.get(level.name)!
        const result = await limiter.check(key, options)

        if (!result.allowed) {
          return { ...result, deniedBy: level.name } as unknown as RateLimitResult
        }
      }

      // All passed - return info from most restrictive
      let mostRestrictive: RateLimitResult | null = null
      for (const level of levels) {
        const key = keys[level.name]
        if (!key) continue
        const info = await levelLimiters.get(level.name)?.peek(key)
        if (
          info &&
          (!mostRestrictive ||
            info.remaining < (mostRestrictive.remaining ?? Number.POSITIVE_INFINITY))
        ) {
          mostRestrictive = {
            allowed: true,
            limit: info.limit,
            remaining: info.remaining,
            resetAt: info.resetAt,
            cost: options?.cost ?? 1,
          } as AllowedResult
        }
      }

      // If we have no info, do a fresh check on the first level
      if (!mostRestrictive) {
        const firstKey = keys[levels[0]!.name]
        if (firstKey) {
          return levelLimiters.get(levels[0]!.name)!.check(firstKey, options)
        }

        // All keys were skipped (all falsy) - allow by default
        return createAllowedResult({ limit: 0, remaining: 0, resetAt: 0, cost: 0 })
      }

      return mostRestrictive
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const result = await this.check(ctx, options)
      if (result.allowed) return result

      const { RateLimitExceededError } = await import('../core/errors.js')
      throw new RateLimitExceededError(
        'Rate limit exceeded',
        result.retryAfter,
        result.limit,
        result.resetAt,
      )
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      const keys = resolveKeys(ctx)
      let mostRestrictive: RateLimitInfo | null = null

      for (const level of levels) {
        const key = keys[level.name]
        if (!key) continue
        const info = await levelLimiters.get(level.name)?.peek(key)
        if (info && (!mostRestrictive || info.remaining < mostRestrictive.remaining)) {
          mostRestrictive = info
        }
      }

      return mostRestrictive
    },

    async reset(ctx: TContext): Promise<void> {
      const keys = resolveKeys(ctx)
      const resets = levels
        .filter((l) => keys[l.name])
        .map((l) => levelLimiters.get(l.name)?.reset(keys[l.name]!))
      await Promise.all(resets)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      await Promise.all([...levelLimiters.values()].map((l) => l.shutdown(options)))
    },
  }
}

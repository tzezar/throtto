import { realClock } from '../core/clock.js'
import { ConfigError, RateLimitExceededError } from '../core/errors.js'
import { createAllowedResult, createDeniedResult } from '../core/result.js'
import type {
  Algorithm,
  AllowedResult,
  CheckOptions,
  Clock,
  Limiter,
  LimiterConfig,
  LimiterHooks,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
  Store,
  StoreEntry,
} from '../core/types.js'
import { rateLimit as presetRateLimit } from './presets.js'

/**
 * Create a rate limiter instance.
 *
 * Accepts either a preset string (e.g. '100/minute') or a full config object.
 *
 * Orchestrates an algorithm, store, and configuration into a
 * ready-to-use limiter with check/consume/peek/reset/shutdown methods.
 */
export function createLimiter(preset: string): Limiter
export function createLimiter<TContext = string>(config: LimiterConfig<TContext>): Limiter<TContext>
export function createLimiter<TContext = string>(
  input: string | LimiterConfig<TContext>,
): Limiter<TContext> {
  if (typeof input === 'string') {
    return presetRateLimit(input) as Limiter<TContext>
  }

  const config = input
  const {
    algorithm,
    store,
    prefix = '',
    failMode = 'open',
    fallbackStore,
    hooks,
    clock = realClock,
    normalizeKey,
  } = config as LimiterConfig<TContext>

  if (!algorithm || typeof algorithm.check !== 'function') {
    throw new ConfigError('Invalid config: "algorithm" is required and must be a valid Algorithm.')
  }
  if (!store || typeof store.get !== 'function') {
    throw new ConfigError('Invalid config: "store" is required and must be a valid Store.')
  }

  function applyNormalization(key: string): string {
    if (!normalizeKey) return key
    if (typeof normalizeKey === 'function') return normalizeKey(key)
    switch (normalizeKey) {
      case 'lowercase':
        return key.toLowerCase()
      case 'trim':
        return key.trim()
      case 'lowercase-trim':
        return key.toLowerCase().trim()
      default:
        return key // unreachable if types are correct, but safe fallback
    }
  }

  function resolveKey(ctx: TContext, options?: CheckOptions): string {
    let key: string
    if (options?.key) key = prefix + options.key
    else if (config.key) key = prefix + config.key(ctx as never)
    else if (typeof ctx === 'string') key = prefix + ctx
    else
      throw new Error(
        'Cannot resolve key: provide a key function in config or pass a string context',
      )
    return applyNormalization(key)
  }

  function resolveCost(ctx: TContext, options?: CheckOptions): number {
    if (options?.cost !== undefined) return options.cost
    if (typeof config.cost === 'function') return (config.cost as (ctx: TContext) => number)(ctx)
    if (typeof config.cost === 'number') return config.cost
    return 1
  }

  async function executeCheck(
    key: string,
    cost: number,
    activeStore: Store,
  ): Promise<RateLimitResult> {
    const now = clock.now()

    if (activeStore.atomic) {
      let algorithmResult: { allowed: boolean; info: RateLimitInfo } | undefined

      await activeStore.atomic(
        key,
        (current) => {
          // If algorithm type doesn't match, treat as fresh start
          const validCurrent =
            current !== null &&
            current.algorithmType !== undefined &&
            current.algorithmType !== algorithm.type
              ? null
              : current
          const state = validCurrent?.state ?? null
          const result = algorithm.check(state, now, cost)
          algorithmResult = { allowed: result.allowed, info: result.info }
          return {
            state: result.state as Record<string, unknown>,
            expiresAt: now + result.ttlMs,
            createdAt: validCurrent?.createdAt ?? now,
            algorithmType: algorithm.type,
          }
        },
        0, // ttlMs is set inside the updater via expiresAt
      )

      const res = algorithmResult!

      if (res.allowed) {
        return createAllowedResult({
          limit: res.info.limit,
          remaining: res.info.remaining,
          resetAt: res.info.resetAt,
          cost,
        })
      }

      return createDeniedResult({
        limit: res.info.limit,
        remaining: res.info.remaining,
        resetAt: res.info.resetAt,
        retryAfter: res.info.retryAfter ?? 0,
        cost,
      })
    }

    // Non-atomic fallback (safe for single-process only)
    const current = await activeStore.get(key)
    // If algorithm type doesn't match, treat as fresh start
    const validCurrent =
      current !== null &&
      current.algorithmType !== undefined &&
      current.algorithmType !== algorithm.type
        ? null
        : current
    const state = validCurrent?.state ?? null
    const result = algorithm.check(state, now, cost)

    const entry: StoreEntry = {
      state: result.state as Record<string, unknown>,
      expiresAt: now + result.ttlMs,
      createdAt: validCurrent?.createdAt ?? now,
      algorithmType: algorithm.type,
    }
    await activeStore.set(key, entry, result.ttlMs)

    if (result.allowed) {
      return createAllowedResult({
        limit: result.info.limit,
        remaining: result.info.remaining,
        resetAt: result.info.resetAt,
        cost,
      })
    }

    return createDeniedResult({
      limit: result.info.limit,
      remaining: result.info.remaining,
      resetAt: result.info.resetAt,
      retryAfter: result.info.retryAfter ?? 0,
      cost,
    })
  }

  function handleFailure(key: string, error: unknown): RateLimitResult {
    hooks?.onError?.(key, error)
    hooks?.onStoreError?.(error)

    if (failMode === 'open') {
      return createAllowedResult({ limit: 0, remaining: 0, resetAt: 0, cost: 0 })
    }

    return createDeniedResult({
      limit: 0,
      remaining: 0,
      resetAt: 0,
      retryAfter: 1000,
      cost: 0,
    })
  }

  const limiter: Limiter<TContext> = {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const key = resolveKey(ctx, options)
      const cost = resolveCost(ctx, options)

      try {
        const result = await executeCheck(key, cost, store)

        if (result.allowed) {
          hooks?.onAllow?.(key, result)
        } else {
          hooks?.onDeny?.(key, result)
        }

        return result
      } catch (error) {
        // Try fallback store if available
        if (fallbackStore) {
          try {
            const result = await executeCheck(key, cost, fallbackStore)
            if (result.allowed) hooks?.onAllow?.(key, result)
            else hooks?.onDeny?.(key, result)
            return result
          } catch (fallbackError) {
            return handleFailure(key, fallbackError)
          }
        }

        return handleFailure(key, error)
      }
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const result = await limiter.check(ctx, options)

      if (result.allowed) {
        return result
      }

      throw new RateLimitExceededError(
        `Rate limit exceeded. Retry after ${result.retryAfter}ms`,
        result.retryAfter,
        result.limit,
        result.resetAt,
      )
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      const key = resolveKey(ctx)
      const now = clock.now()

      try {
        const current = await store.get(key)
        if (!current) return null

        if (algorithm.peek) {
          return algorithm.peek(current.state, now)
        }

        // Fallback: run check without modifying state
        const result = algorithm.check(current.state, now, 0)
        return result.info
      } catch {
        return null
      }
    },

    async reset(ctx: TContext): Promise<void> {
      const key = resolveKey(ctx)
      await store.delete(key)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      const timeout = options?.timeout
      const shutdownPromise = store.shutdown?.() ?? Promise.resolve()

      if (timeout) {
        await Promise.race([
          shutdownPromise,
          new Promise<void>((resolve) => {
            const id = (globalThis as Record<string, unknown>).setTimeout as (
              fn: () => void,
              ms: number,
            ) => unknown
            if (id) id(resolve, timeout)
            else resolve()
          }),
        ])
      } else {
        await shutdownPromise
      }
    },
  }

  return limiter
}

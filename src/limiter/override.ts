import { RateLimitExceededError } from '../core/errors.js'
import { isLimiter } from '../core/guards.js'
import { createAllowedResult, createDeniedResult } from '../core/result.js'
import type {
  AllowedResult,
  CheckOptions,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
} from '../core/types.js'

export type OverrideAction = 'allow' | 'deny' | 'none'

export interface OverrideEntry {
  action: 'allow' | 'deny'
  reason?: string | undefined
  expiresAt?: number | undefined
}

export interface OverrideLimiter<TContext = string> extends Limiter<TContext> {
  setOverride(key: string, entry: OverrideEntry): void
  removeOverride(key: string): void
  getOverride(key: string): OverrideEntry | null
  listOverrides(): Array<{ key: string; entry: OverrideEntry }>
  clearOverrides(): void
}

function resolveAction(entry: OverrideEntry | undefined): OverrideAction {
  if (!entry) return 'none'
  if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
    return 'none'
  }
  return entry.action
}

function withOverrideImpl<TContext = string>(
  limiter: Limiter<TContext>,
): OverrideLimiter<TContext> {
  const overrides = new Map<string, OverrideEntry>()

  function getActiveOverride(key: string): {
    action: OverrideAction
    entry: OverrideEntry | undefined
  } {
    const entry = overrides.get(key)
    if (!entry) return { action: 'none', entry: undefined }
    const action = resolveAction(entry)
    if (action === 'none') {
      overrides.delete(key)
      return { action: 'none', entry: undefined }
    }
    return { action, entry }
  }

  function createOverrideAllowed(): AllowedResult {
    return createAllowedResult({
      limit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      resetAt: 0,
      cost: 0,
    })
  }

  return {
    ...limiter,
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const key = options?.key ?? String(ctx)
      const { action, entry } = getActiveOverride(key)

      if (action === 'allow') {
        return createOverrideAllowed()
      }
      if (action === 'deny') {
        return createDeniedResult({
          limit: 0,
          remaining: 0,
          resetAt: entry?.expiresAt ?? 0,
          retryAfter: 0,
          cost: 0,
        })
      }

      return limiter.check(ctx, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const key = options?.key ?? String(ctx)
      const { action, entry } = getActiveOverride(key)

      if (action === 'allow') {
        return createOverrideAllowed()
      }
      if (action === 'deny') {
        throw new RateLimitExceededError(
          entry?.reason ?? 'Rate limit override: denied',
          0,
          0,
          entry?.expiresAt ?? 0,
        )
      }

      return limiter.consume(ctx, options)
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      return limiter.peek(ctx)
    },

    async reset(ctx: TContext): Promise<void> {
      return limiter.reset(ctx)
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      return limiter.shutdown(options)
    },

    setOverride(key: string, entry: OverrideEntry): void {
      overrides.set(key, entry)
    },

    removeOverride(key: string): void {
      overrides.delete(key)
    },

    getOverride(key: string): OverrideEntry | null {
      const entry = overrides.get(key)
      if (!entry) return null
      const action = resolveAction(entry)
      if (action === 'none') {
        overrides.delete(key)
        return null
      }
      return entry
    },

    listOverrides(): Array<{ key: string; entry: OverrideEntry }> {
      const result: Array<{ key: string; entry: OverrideEntry }> = []
      for (const [key, entry] of overrides) {
        const action = resolveAction(entry)
        if (action === 'none') {
          overrides.delete(key)
        } else {
          result.push({ key, entry })
        }
      }
      return result
    },

    clearOverrides(): void {
      overrides.clear()
    },
  }
}

/**
 * Wrap a limiter with per-key allow/deny overrides.
 *
 * Curried form (no arguments) returns a transform for use with `pipe()`.
 */
export function withOverride<TContext = string>(): (
  limiter: Limiter<TContext>,
) => OverrideLimiter<TContext>
export function withOverride<TContext = string>(
  limiter: Limiter<TContext>,
): OverrideLimiter<TContext>
export function withOverride<TContext = string>(
  limiter?: Limiter<TContext>,
): OverrideLimiter<TContext> | ((limiter: Limiter<TContext>) => OverrideLimiter<TContext>) {
  if (limiter === undefined) {
    return (l: Limiter<TContext>) => withOverrideImpl(l)
  }
  return withOverrideImpl(limiter)
}

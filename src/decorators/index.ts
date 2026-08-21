import type { CheckOptions, Limiter } from '../core/types.js'

// ─── Metadata Storage ────────────────────────────────────────────────────────
// Use WeakMaps to store decorator metadata (works without reflect-metadata)

const throttleMetadata = new WeakMap<object, ThrottleOptions>()
const skipMetadata = new WeakMap<object, boolean>()
const costMetadata = new WeakMap<object, number | ((args: unknown[]) => number)>()

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThrottleOptions {
  /** Rate limit string (e.g., '100/minute') or custom limiter */
  limit?: string | undefined
  /** Custom limiter instance */
  limiter?: Limiter | undefined
  /** Key resolver for this method/class */
  key?: string | ((target: unknown, ...args: unknown[]) => string) | undefined
  /** Cost for this operation */
  cost?: number | undefined
}

export interface DecoratorContext {
  /** Get throttle options for a target (class or method) */
  getThrottleOptions(target: object): ThrottleOptions | undefined
  /** Check if throttling is skipped for a target */
  isSkipped(target: object): boolean
  /** Get cost for a target */
  getCost(target: object): number | ((args: unknown[]) => number) | undefined
}

// ─── Decorator Factories ─────────────────────────────────────────────────────

/**
 * Marks a class or method for rate limiting.
 *
 * Usage:
 * ```ts
 * @Throttle({ limit: '100/minute' })
 * class ApiController {
 *
 *   @Throttle({ limit: '10/minute', cost: 5 })
 *   async expensiveOperation() { ... }
 * }
 * ```
 *
 * Note: This stores metadata only. The actual enforcement must be done by
 * a framework integration (e.g., NestJS guard, custom interceptor).
 */
export function Throttle(options: ThrottleOptions = {}): ClassDecorator & MethodDecorator {
  return function decorator(target: unknown, _propertyKey?: string | symbol): void {
    if (typeof target === 'function') {
      // Class decorator
      throttleMetadata.set(target.prototype as object, options)
    } else if (target && typeof target === 'object') {
      // Method decorator - store on prototype with property key
      throttleMetadata.set(target as object, options)
    }
  } as ClassDecorator & MethodDecorator
}

/**
 * Skips rate limiting for a class or method.
 *
 * Usage:
 * ```ts
 * @Throttle({ limit: '100/minute' })
 * class ApiController {
 *
 *   @SkipThrottle()
 *   async healthCheck() { ... }
 * }
 * ```
 */
export function SkipThrottle(): ClassDecorator & MethodDecorator {
  return function decorator(target: unknown): void {
    if (typeof target === 'function') {
      skipMetadata.set(target.prototype as object, true)
    } else if (target && typeof target === 'object') {
      skipMetadata.set(target as object, true)
    }
  } as ClassDecorator & MethodDecorator
}

/**
 * Sets the cost for a method (used with rate limiting).
 *
 * Usage:
 * ```ts
 * class ApiController {
 *   @ThrottleCost(5)
 *   async heavyQuery() { ... }
 *
 *   @ThrottleCost((args) => args[0]?.items?.length ?? 1)
 *   async batchProcess(data: { items: unknown[] }) { ... }
 * }
 * ```
 */
export function ThrottleCost(cost: number | ((args: unknown[]) => number)): MethodDecorator {
  return function decorator(target: unknown): void {
    if (target && typeof target === 'object') {
      costMetadata.set(target as object, cost)
    }
  } as MethodDecorator
}

// ─── Metadata Access ─────────────────────────────────────────────────────────

/**
 * Creates a decorator context for reading metadata.
 * Used by framework integrations to read decorator config.
 */
export function createDecoratorContext(): DecoratorContext {
  return {
    getThrottleOptions(target: object): ThrottleOptions | undefined {
      return throttleMetadata.get(target)
    },

    isSkipped(target: object): boolean {
      return skipMetadata.get(target) ?? false
    },

    getCost(target: object): number | ((args: unknown[]) => number) | undefined {
      return costMetadata.get(target)
    },
  }
}

// ─── Helper: Apply Throttle to Function ──────────────────────────────────────

/**
 * Wraps a function with rate limiting (programmatic alternative to decorators).
 *
 * Usage:
 * ```ts
 * const throttled = withThrottle(myFunction, {
 *   limiter,
 *   key: 'my-operation',
 * })
 * ```
 */
export function withThrottle<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: {
    limiter: Limiter
    key: string | ((...args: TArgs) => string)
    cost?: number | undefined
  },
): (...args: TArgs) => Promise<TReturn> {
  const { limiter, key, cost } = options

  return async (...args: TArgs): Promise<TReturn> => {
    const resolvedKey = typeof key === 'function' ? key(...args) : key
    const checkOptions: CheckOptions = {}
    if (cost !== undefined) checkOptions.cost = cost

    const result = await limiter.check(resolvedKey, checkOptions)
    if (!result.allowed) {
      throw new Error(`Rate limit exceeded for: ${resolvedKey}`)
    }

    return fn(...args)
  }
}

// ─── Type Helpers ────────────────────────────────────────────────────────────

type ClassDecorator = (target: unknown) => void
type MethodDecorator = (
  target: unknown,
  propertyKey?: string | symbol,
  descriptor?: unknown,
) => void

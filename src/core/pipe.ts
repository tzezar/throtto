import type { Limiter } from './types.js'

/** A function that transforms a Limiter into another Limiter */
export type LimiterTransform<TContext = string> = (limiter: Limiter<TContext>) => Limiter<TContext>

/**
 * Compose a limiter with a chain of transforms, applied left to right.
 *
 * @example
 * ```ts
 * const limiter = pipe(
 *   rateLimit({ limit: 100, window: '1m' }),
 *   withDryRun({ onShadowDeny: console.log }),
 *   withAllowlist({ allowlist: ['admin-key'] }),
 *   withOverride(),
 * )
 * ```
 */
export function pipe<TContext = string>(
  limiter: Limiter<TContext>,
  ...transforms: LimiterTransform<TContext>[]
): Limiter<TContext> {
  let result = limiter
  for (const transform of transforms) {
    result = transform(result)
  }
  return result
}

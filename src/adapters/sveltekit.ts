import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── SvelteKit Types ─────────────────────────────────────────────────────────

export interface SvelteKitEvent {
  request: Request
  url: URL
  getClientAddress(): string
  locals: Record<string, unknown>
}

export type SvelteKitResolve = (event: SvelteKitEvent) => Promise<Response>

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SvelteKitAdapterConfig {
  /** Pre-created limiter instance. If not provided, one is created from limit/window. */
  limiter?: Limiter | undefined
  /** Shorthand: request limit. Required if limiter is not provided. */
  limit?: number | undefined
  /** Shorthand: window duration. Required if limit is provided. */
  window?: Duration | undefined
  /** Algorithm when creating inline limiter. Default: 'sliding-window-counter' */
  algorithm?:
    | 'sliding-window-counter'
    | 'fixed-window'
    | 'token-bucket'
    | 'sliding-window-log'
    | 'leaky-bucket'
    | 'gcra'
    | 'concurrency'
    | undefined
  /** Store when creating inline limiter. Default: memory */
  store?: Store | undefined
  key?: ((event: SvelteKitEvent) => string) | undefined
  cost?: number | ((event: SvelteKitEvent) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((event: SvelteKitEvent) => boolean) | undefined
  onDeny?:
    | ((event: SvelteKitEvent, result: RateLimitResult) => Response | undefined | null)
    | undefined
  /** Path patterns to rate limit. If not set, all paths are limited. */
  paths?: string[] | undefined
  /** Paths to exclude */
  excludePaths?: string[] | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(
  input: SvelteKitAdapterConfig | string,
): SvelteKitAdapterConfig & { limiter: Limiter } {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }

  const limiter =
    input.limiter ??
    (() => {
      if (input.limit === undefined) {
        throw new ConfigError('Either "limiter" or "limit" (with "window") must be provided.')
      }
      if (input.window === undefined) {
        throw new ConfigError(
          "'window' is required when using inline config. Example: { limit: 100, window: '1m' }",
        )
      }
      return createInternalLimiter({
        limit: input.limit,
        window: input.window,
        algorithm: input.algorithm,
        store: input.store,
      })
    })()

  return { ...input, limiter }
}

// ─── Handle Hook ─────────────────────────────────────────────────────────────

/**
 * Creates a SvelteKit handle hook for rate limiting.
 *
 * Usage in hooks.server.ts:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/sveltekit'
 *
 * export const handle = rateLimit('100/minute')
 * // Or with full config:
 * export const handle = rateLimit({
 *   limiter: myLimiter,
 *   paths: ['/api/*'],
 * })
 * ```
 */
export function rateLimit(
  config: SvelteKitAdapterConfig | string,
): (input: { event: SvelteKitEvent; resolve: SvelteKitResolve }) => Promise<Response> {
  const resolved = resolveConfig(config)

  const {
    limiter,
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skip,
    skipPaths,
    skipMethods,
    onDeny,
    paths,
    excludePaths,
  } = resolved

  return async ({ event, resolve }): Promise<Response> => {
    const pathname = event.url.pathname

    // Path filtering
    if (paths && !matchesAny(pathname, paths)) return resolve(event)
    if (excludePaths && matchesAny(pathname, excludePaths)) return resolve(event)

    if (skipPaths || skipMethods) {
      if (shouldSkip(pathname, event.request.method, { skipPaths, skipMethods })) {
        return resolve(event)
      }
    }

    if (skip?.(event)) return resolve(event)

    const resolvedKey = keyResolver ? keyResolver(event) : event.getClientAddress()
    const resolvedCost = typeof cost === 'function' ? cost(event) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    // Store in locals for use in endpoints
    event.locals.rateLimitResult = result

    if (result.allowed) {
      const response = await resolve(event)
      if (includeHeaders) {
        const rateLimitHeaders = toHeaders(result, { format: headerFormat })
        for (const [name, value] of Object.entries(rateLimitHeaders)) {
          response.headers.set(name, value)
        }
      }
      return response
    }

    // Denied
    if (onDeny) {
      const custom = onDeny(event, result)
      if (custom) return custom
    }

    const body = toErrorBody(result)
    const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        responseHeaders.set(name, value)
      }
    }

    return new Response(JSON.stringify(body), { status: 429, headers: responseHeaders })
  }
}

function matchesAny(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p === '*') return true
    const regex = p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
    return new RegExp(`^${regex}$`).test(pathname)
  })
}

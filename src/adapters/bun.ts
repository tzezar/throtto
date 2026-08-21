import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Bun Types ───────────────────────────────────────────────────────────────

export interface BunServer {
  requestIP(req: Request): { address: string } | null
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface BunAdapterConfig {
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
  key?: ((req: Request, server: BunServer) => string) | undefined
  cost?: number | ((req: Request) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((req: Request) => boolean) | undefined
  onDeny?: ((req: Request, result: RateLimitResult) => Response | undefined | null) | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(input: BunAdapterConfig | string): BunAdapterConfig & { limiter: Limiter } {
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

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Creates a Bun.serve rate limit handler.
 *
 * Overload 1 — check-only (returns `Response | null`):
 * ```ts
 * import { rateLimit } from 'throtto/adapters/bun'
 *
 * const check = rateLimit('100/minute')
 * Bun.serve({
 *   fetch(req, server) {
 *     const denied = await check(req, server)
 *     if (denied) return denied
 *     return new Response('OK')
 *   }
 * })
 * ```
 *
 * Overload 2 — wraps a handler:
 * ```ts
 * Bun.serve({
 *   fetch: rateLimit({ limiter }, (req, server) => new Response('OK'))
 * })
 * ```
 */
export function rateLimit(
  config: BunAdapterConfig | string,
): (req: Request, server: BunServer) => Promise<Response | null>
export function rateLimit(
  config: BunAdapterConfig | string,
  handler: (req: Request, server: BunServer) => Response | Promise<Response>,
): (req: Request, server: BunServer) => Promise<Response>
export function rateLimit(
  config: BunAdapterConfig | string,
  handler?: (req: Request, server: BunServer) => Response | Promise<Response>,
):
  | ((req: Request, server: BunServer) => Promise<Response | null>)
  | ((req: Request, server: BunServer) => Promise<Response>) {
  const resolved = resolveConfig(config)

  if (handler) {
    return createHandlerWrapper(resolved, handler)
  }
  return createCheckOnly(resolved)
}

// ─── Check-Only Form ─────────────────────────────────────────────────────────

function createCheckOnly(
  config: BunAdapterConfig & { limiter: Limiter },
): (req: Request, server: BunServer) => Promise<Response | null> {
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
  } = config

  return async (req: Request, server: BunServer): Promise<Response | null> => {
    if (skipPaths || skipMethods) {
      const url = new URL(req.url)
      if (shouldSkip(url.pathname, req.method, { skipPaths, skipMethods })) return null
    }

    if (skip?.(req)) return null

    const resolvedKey = keyResolver
      ? keyResolver(req, server)
      : (server.requestIP(req)?.address ?? extractIp(req))
    const resolvedCost = typeof cost === 'function' ? cost(req) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (result.allowed) return null

    if (onDeny) {
      const custom = onDeny(req, result)
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

// ─── Handler Wrapper Form ────────────────────────────────────────────────────

function createHandlerWrapper(
  config: BunAdapterConfig & { limiter: Limiter },
  handler: (req: Request, server: BunServer) => Response | Promise<Response>,
): (req: Request, server: BunServer) => Promise<Response> {
  const check = createCheckOnly(config)

  return async (req: Request, server: BunServer): Promise<Response> => {
    const denied = await check(req, server)
    if (denied) return denied
    return handler(req, server)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractIp(req: Request): string {
  const cfIp = req.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    return parts[parts.length - 1]?.trim() ?? 'unknown'
  }
  return 'unknown'
}

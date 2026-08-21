import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Cloudflare Workers Types ────────────────────────────────────────────────

export interface CFExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CloudflareAdapterConfig {
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
  key?: ((req: Request) => string) | undefined
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

function resolveConfig(
  input: CloudflareAdapterConfig | string,
): CloudflareAdapterConfig & { limiter: Limiter } {
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
 * Creates a Cloudflare Workers rate limit handler.
 *
 * Overload 1 — check-only (returns `Response | null`):
 * ```ts
 * import { rateLimit } from 'throtto/adapters/cloudflare-workers'
 *
 * const check = rateLimit('1000/minute')
 * export default {
 *   async fetch(request, env, ctx) {
 *     const denied = await check(request, env, ctx)
 *     if (denied) return denied
 *     return new Response('Hello!')
 *   }
 * }
 * ```
 *
 * Overload 2 — wraps a handler:
 * ```ts
 * export default {
 *   fetch: rateLimit({ limiter }, async (request, env, ctx) => {
 *     return new Response('Hello!')
 *   })
 * }
 * ```
 */
export function rateLimit(
  config: CloudflareAdapterConfig | string,
): (request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response | null>
export function rateLimit(
  config: CloudflareAdapterConfig | string,
  handler: (request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response>,
): (request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response>
export function rateLimit(
  config: CloudflareAdapterConfig | string,
  handler?: (request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response>,
):
  | ((request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response | null>)
  | ((request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response>) {
  const resolved = resolveConfig(config)

  if (handler) {
    return createHandlerWrapper(resolved, handler)
  }
  return createCheckOnly(resolved)
}

// ─── Check-Only Form ─────────────────────────────────────────────────────────

function createCheckOnly(
  config: CloudflareAdapterConfig & { limiter: Limiter },
): (request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response | null> {
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

  return async (
    request: Request,
    _env: unknown,
    _ctx: CFExecutionContext,
  ): Promise<Response | null> => {
    if (skipPaths || skipMethods) {
      const url = new URL(request.url)
      if (shouldSkip(url.pathname, request.method, { skipPaths, skipMethods })) return null
    }

    if (skip?.(request)) return null

    const resolvedKey = keyResolver ? keyResolver(request) : extractCFIp(request)
    const resolvedCost = typeof cost === 'function' ? cost(request) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (result.allowed) return null

    if (onDeny) {
      const custom = onDeny(request, result)
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
  config: CloudflareAdapterConfig & { limiter: Limiter },
  handler: (request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response>,
): (request: Request, env: unknown, ctx: CFExecutionContext) => Promise<Response> {
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

  return async (request: Request, env: unknown, ctx: CFExecutionContext): Promise<Response> => {
    if (skipPaths || skipMethods) {
      const url = new URL(request.url)
      if (shouldSkip(url.pathname, request.method, { skipPaths, skipMethods })) {
        return handler(request, env, ctx)
      }
    }

    if (skip?.(request)) {
      return handler(request, env, ctx)
    }

    const resolvedKey = keyResolver ? keyResolver(request) : extractCFIp(request)
    const resolvedCost = typeof cost === 'function' ? cost(request) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (!result.allowed) {
      if (onDeny) {
        const custom = onDeny(request, result)
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

    const response = await handler(request, env, ctx)

    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      const cloned = response.clone()
      const newResponse = new Response(await cloned.text(), {
        status: response.status,
        statusText: response.statusText,
      })
      // First: copy original response headers
      response.headers.forEach((value: string, key: string) => {
        newResponse.headers.set(key, value)
      })
      // Then: set rate limit headers (overrides any originals with same name)
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        newResponse.headers.set(name, value)
      }
      return newResponse
    }

    return response
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractCFIp(request: Request): string {
  // cf-connecting-ip is always set by Cloudflare
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}

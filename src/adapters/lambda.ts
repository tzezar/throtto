import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Lambda Types ────────────────────────────────────────────────────────────

export interface APIGatewayEvent {
  headers: Record<string, string | undefined>
  requestContext: {
    identity?: { sourceIp?: string | undefined } | undefined
    http?: { sourceIp?: string | undefined } | undefined
  }
  httpMethod?: string | undefined
  path?: string | undefined
  rawPath?: string | undefined
  body?: string | null | undefined
}

export interface APIGatewayResult {
  statusCode: number
  headers: Record<string, string>
  body: string
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface LambdaAdapterConfig {
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
  key?: ((event: APIGatewayEvent) => string) | undefined
  cost?: number | ((event: APIGatewayEvent) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((event: APIGatewayEvent) => boolean) | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(
  input: LambdaAdapterConfig | string,
): LambdaAdapterConfig & { limiter: Limiter } {
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
 * Creates a Lambda rate limit handler.
 *
 * Overload 1 — check-only (returns `APIGatewayResult | null`):
 * ```ts
 * import { rateLimit } from 'throtto/adapters/lambda'
 *
 * const check = rateLimit('100/minute')
 * export async function handler(event) {
 *   const denied = await check(event)
 *   if (denied) return denied
 *   return { statusCode: 200, headers: {}, body: '...' }
 * }
 * ```
 *
 * Overload 2 — wraps a handler:
 * ```ts
 * export const handler = rateLimit({ limiter }, async (event) => ({
 *   statusCode: 200,
 *   headers: {},
 *   body: JSON.stringify({ ok: true }),
 * }))
 * ```
 */
export function rateLimit(
  config: LambdaAdapterConfig | string,
): (event: APIGatewayEvent) => Promise<APIGatewayResult | null>
export function rateLimit(
  config: LambdaAdapterConfig | string,
  handler: (event: APIGatewayEvent) => Promise<APIGatewayResult>,
): (event: APIGatewayEvent) => Promise<APIGatewayResult>
export function rateLimit(
  config: LambdaAdapterConfig | string,
  handler?: (event: APIGatewayEvent) => Promise<APIGatewayResult>,
):
  | ((event: APIGatewayEvent) => Promise<APIGatewayResult | null>)
  | ((event: APIGatewayEvent) => Promise<APIGatewayResult>) {
  const resolved = resolveConfig(config)

  if (handler) {
    return createHandlerWrapper(resolved, handler)
  }
  return createCheckOnly(resolved)
}

// ─── Check-Only Form ─────────────────────────────────────────────────────────

function createCheckOnly(
  config: LambdaAdapterConfig & { limiter: Limiter },
): (event: APIGatewayEvent) => Promise<APIGatewayResult | null> {
  const {
    limiter,
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skip,
    skipPaths,
    skipMethods,
  } = config

  return async (event: APIGatewayEvent): Promise<APIGatewayResult | null> => {
    if (skipPaths || skipMethods) {
      const path = event.path ?? event.rawPath ?? '/'
      const method = event.httpMethod ?? 'GET'
      if (shouldSkip(path, method, { skipPaths, skipMethods })) return null
    }

    if (skip?.(event)) return null

    const resolvedKey = keyResolver ? keyResolver(event) : extractIp(event)
    const resolvedCost = typeof cost === 'function' ? cost(event) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (result.allowed) return null

    const rateLimitHeaders = includeHeaders ? toHeaders(result, { format: headerFormat }) : {}
    const body = toErrorBody(result)

    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders },
      body: JSON.stringify(body),
    }
  }
}

// ─── Handler Wrapper Form ────────────────────────────────────────────────────

function createHandlerWrapper(
  config: LambdaAdapterConfig & { limiter: Limiter },
  handler: (event: APIGatewayEvent) => Promise<APIGatewayResult>,
): (event: APIGatewayEvent) => Promise<APIGatewayResult> {
  const {
    limiter,
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skip,
    skipPaths,
    skipMethods,
  } = config

  return async (event: APIGatewayEvent): Promise<APIGatewayResult> => {
    if (skipPaths || skipMethods) {
      const path = event.path ?? event.rawPath ?? '/'
      const method = event.httpMethod ?? 'GET'
      if (shouldSkip(path, method, { skipPaths, skipMethods })) {
        return handler(event)
      }
    }

    if (skip?.(event)) {
      return handler(event)
    }

    const resolvedKey = keyResolver ? keyResolver(event) : extractIp(event)
    const resolvedCost = typeof cost === 'function' ? cost(event) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    const rateLimitHeaders = includeHeaders ? toHeaders(result, { format: headerFormat }) : {}

    if (!result.allowed) {
      const body = toErrorBody(result)
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json', ...rateLimitHeaders },
        body: JSON.stringify(body),
      }
    }

    const response = await handler(event)
    return {
      ...response,
      headers: { ...response.headers, ...rateLimitHeaders },
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractIp(event: APIGatewayEvent): string {
  // API Gateway v2
  const httpIp = event.requestContext.http?.sourceIp
  if (httpIp) return httpIp

  // API Gateway v1
  const identityIp = event.requestContext.identity?.sourceIp
  if (identityIp) return identityIp

  // Headers fallback
  const cfIp = event.headers['cf-connecting-ip']
  if (cfIp) return cfIp
  const forwarded = event.headers['x-forwarded-for']
  if (forwarded) {
    const parts = forwarded.split(',')
    return parts[parts.length - 1]?.trim() ?? 'unknown'
  }

  return 'unknown'
}

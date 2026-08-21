import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

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
  limiter: Limiter
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

// ─── Handler Wrapper ─────────────────────────────────────────────────────────

/**
 * Wraps an AWS Lambda handler with rate limiting.
 * Supports both API Gateway v1 (REST) and v2 (HTTP) events.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { withLambdaRateLimit } from 'throtto/adapters/lambda'
 *
 * const handler = withLambdaRateLimit(
 *   { limiter: rateLimit('100/minute') },
 *   async (event) => ({
 *     statusCode: 200,
 *     headers: {},
 *     body: JSON.stringify({ ok: true }),
 *   })
 * )
 *
 * export { handler }
 * ```
 */
export function withLambdaRateLimit(
  config: LambdaAdapterConfig,
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

/**
 * Standalone rate limit check for Lambda (use with middy or custom middleware).
 */
export async function lambdaRateLimitCheck(
  config: LambdaAdapterConfig,
  event: APIGatewayEvent,
): Promise<APIGatewayResult | null> {
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

import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

// ─── Cloudflare Workers Types ────────────────────────────────────────────────

export interface CFExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CloudflareAdapterConfig {
  limiter: Limiter
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

// ─── Handler Wrapper ─────────────────────────────────────────────────────────

/**
 * Wraps a Cloudflare Workers fetch handler with rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { withCFRateLimit } from 'throtto/adapters/cloudflare-workers'
 *
 * export default {
 *   fetch: withCFRateLimit(
 *     { limiter: rateLimit('1000/minute') },
 *     async (request, env, ctx) => {
 *       return new Response('Hello!')
 *     }
 *   )
 * }
 * ```
 */
export function withCFRateLimit(
  config: CloudflareAdapterConfig,
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

function extractCFIp(request: Request): string {
  // cf-connecting-ip is always set by Cloudflare
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}

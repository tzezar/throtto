import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

// ─── Remix Types ─────────────────────────────────────────────────────────────

export interface RemixArgs {
  request: Request
  params: Record<string, string | undefined>
  context?: unknown
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RemixAdapterConfig {
  limiter: Limiter
  key?: ((args: RemixArgs) => string) | undefined
  cost?: number | ((args: RemixArgs) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((args: RemixArgs) => boolean) | undefined
}

// ─── Wrapper ─────────────────────────────────────────────────────────────────

/**
 * Wraps a Remix loader or action with rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { withRemixRateLimit } from 'throtto/adapters/remix'
 *
 * export const loader = withRemixRateLimit(
 *   { limiter: rateLimit('50/minute') },
 *   async ({ request }) => {
 *     return json({ data: '...' })
 *   }
 * )
 * ```
 */
export function withRemixRateLimit(
  config: RemixAdapterConfig,
  handler: (args: RemixArgs) => Promise<Response> | Response,
): (args: RemixArgs) => Promise<Response> {
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

  return async (args: RemixArgs): Promise<Response> => {
    if (skipPaths || skipMethods) {
      const url = new URL(args.request.url)
      if (shouldSkip(url.pathname, args.request.method, { skipPaths, skipMethods })) {
        return handler(args)
      }
    }

    if (skip?.(args)) {
      return handler(args)
    }

    const resolvedKey = keyResolver ? keyResolver(args) : extractIp(args.request)
    const resolvedCost = typeof cost === 'function' ? cost(args) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (!result.allowed) {
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

    const response = await handler(args)

    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        response.headers.set(name, value)
      }
    }

    return response
  }
}

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

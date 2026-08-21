import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

// ─── Deno Types ──────────────────────────────────────────────────────────────

export interface DenoServeHandlerInfo {
  remoteAddr: { hostname: string; port: number }
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface DenoAdapterConfig {
  limiter: Limiter
  key?: ((req: Request, info: DenoServeHandlerInfo) => string) | undefined
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
 * Creates a Deno.serve handler with rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { denoRateLimit, withDenoRateLimit } from 'throtto/adapters/deno'
 *
 * Deno.serve(withDenoRateLimit(
 *   { limiter: rateLimit('100/minute') },
 *   (req) => new Response('Hello Deno!')
 * ))
 * ```
 */
export function denoRateLimit(
  config: DenoAdapterConfig,
): (req: Request, info: DenoServeHandlerInfo) => Promise<Response | null> {
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

  return async (req: Request, info: DenoServeHandlerInfo): Promise<Response | null> => {
    if (skipPaths || skipMethods) {
      const url = new URL(req.url)
      if (shouldSkip(url.pathname, req.method, { skipPaths, skipMethods })) return null
    }

    if (skip?.(req)) return null

    const resolvedKey = keyResolver ? keyResolver(req, info) : info.remoteAddr.hostname
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

/**
 * Wraps a Deno serve handler with rate limiting.
 */
export function withDenoRateLimit(
  config: DenoAdapterConfig,
  handler: (req: Request, info: DenoServeHandlerInfo) => Response | Promise<Response>,
): (req: Request, info: DenoServeHandlerInfo) => Promise<Response> {
  const check = denoRateLimit(config)

  return async (req: Request, info: DenoServeHandlerInfo): Promise<Response> => {
    const denied = await check(req, info)
    if (denied) return denied
    return handler(req, info)
  }
}

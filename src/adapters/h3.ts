import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── H3 Types ────────────────────────────────────────────────────────────────

export interface H3Event {
  node: {
    req: {
      headers: Record<string, string | string[] | undefined>
      socket?: { remoteAddress?: string | undefined } | undefined
    }
    res: {
      setHeader(name: string, value: string): void
      statusCode: number
      end(body?: string): void
    }
  }
  path: string
  method: string
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface H3AdapterConfig {
  limiter: Limiter
  key?: ((event: H3Event) => string) | undefined
  cost?: number | ((event: H3Event) => number) | undefined
  headers?: boolean | undefined
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  skip?: ((event: H3Event) => boolean) | undefined
  onDeny?: ((event: H3Event, result: RateLimitResult) => void) | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(input: H3AdapterConfig | string): H3AdapterConfig {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }
  return input
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates an H3 event handler middleware for rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/h3'
 *
 * export default defineEventHandler(rateLimit('100/minute'))
 * ```
 */
export function rateLimit(
  config: H3AdapterConfig | string,
): (event: H3Event) => Promise<undefined | string> {
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
  } = resolved

  return async (event: H3Event): Promise<undefined | string> => {
    if (skipPaths || skipMethods) {
      if (shouldSkip(event.path, event.method, { skipPaths, skipMethods })) return
    }

    if (skip?.(event)) return

    const resolvedKey = keyResolver ? keyResolver(event) : extractIp(event)
    const resolvedCost = typeof cost === 'function' ? cost(event) : cost

    const result = await limiter.check(resolvedKey, { cost: resolvedCost })

    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        event.node.res.setHeader(name, value)
      }
    }

    if (result.allowed) return

    if (onDeny) {
      onDeny(event, result)
      return
    }

    event.node.res.statusCode = 429
    event.node.res.setHeader('Content-Type', 'application/json')
    const body = toErrorBody(result)
    event.node.res.end(JSON.stringify(body))
  }
}

function extractIp(event: H3Event): string {
  const headers = event.node.req.headers
  const cfIp = headers['cf-connecting-ip']
  if (cfIp) return Array.isArray(cfIp) ? (cfIp[0] ?? 'unknown') : cfIp
  const realIp = headers['x-real-ip']
  if (realIp) return Array.isArray(realIp) ? (realIp[0] ?? 'unknown') : realIp
  const forwarded = headers['x-forwarded-for']
  if (forwarded) {
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (value) {
      const parts = value.split(',')
      return parts[parts.length - 1]?.trim() ?? 'unknown'
    }
  }
  return event.node.req.socket?.remoteAddress ?? 'unknown'
}

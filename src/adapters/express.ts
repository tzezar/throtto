import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit } from '../limiter/presets.js'

// ─── Express Types ───────────────────────────────────────────────────────────
// Minimal types compatible with Express req/res/next

export interface ExpressRequest {
  ip?: string | undefined
  headers: Record<string, string | string[] | undefined>
  method?: string | undefined
  url?: string | undefined
  path?: string | undefined
}

export interface ExpressResponse {
  status(code: number): ExpressResponse
  set(headers: Record<string, string>): ExpressResponse
  setHeader(name: string, value: string): void
  json(body: unknown): void
  headersSent?: boolean | undefined
}

export type ExpressNextFunction = (err?: unknown) => void

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ExpressAdapterConfig {
  /** Pre-created limiter instance */
  limiter?: Limiter | undefined
  /** Shorthand: limit (creates limiter internally). Ignored if limiter is provided. */
  limit?: number | undefined
  /** Shorthand: window duration. Required if limit is provided. */
  window?: Duration | undefined
  /** Shorthand: algorithm. Default: 'sliding-window-counter' */
  algorithm?:
    | 'sliding-window-counter'
    | 'fixed-window'
    | 'token-bucket'
    | 'sliding-window-log'
    | 'leaky-bucket'
    | 'gcra'
    | 'concurrency'
    | undefined
  /** Store to use when creating inline limiter. Default: memory */
  store?: Store | undefined
  /** Key resolver. Default: req.ip */
  key?: ((req: ExpressRequest) => string) | undefined
  /** Cost per request. Default: 1 */
  cost?: number | ((req: ExpressRequest) => number) | undefined
  /** Whether to set rate limit headers. Default: true */
  headers?: boolean | undefined
  /** Header format. Default: 'draft-7' */
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  /** Skip rate limiting for matching requests */
  skip?: ((req: ExpressRequest) => boolean) | undefined
  /** Custom deny handler. If provided, must send the response. */
  onDeny?:
    | ((req: ExpressRequest, res: ExpressResponse, result: RateLimitResult) => void)
    | undefined
  /** HTTP status code for rate limited responses. Default: 429 */
  statusCode?: number | undefined
  /** Custom error message or body generator */
  message?: string | ((result: RateLimitResult) => unknown) | undefined
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates an Express/Connect middleware for rate limiting.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { expressRateLimit } from 'throtto/adapters/express'
 *
 * const limiter = rateLimit('100/minute')
 * app.use(expressRateLimit({ limiter }))
 * ```
 */
export function expressRateLimit(
  config: ExpressAdapterConfig,
): (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => void {
  if (!config.limiter && config.limit === undefined) {
    throw new ConfigError('Either "limiter" or "limit" (with "window") must be provided.')
  }

  if (!config.limiter && config.limit !== undefined && config.window === undefined) {
    throw new ConfigError(
      "'window' is required when using inline rate limit config. Example: { limit: 100, window: '1m' }",
    )
  }

  const resolvedLimiter =
    config.limiter ??
    rateLimit({
      limit: config.limit!,
      window: config.window!,
      algorithm: config.algorithm,
      store: config.store,
    })

  const {
    key: keyResolver,
    cost,
    headers: includeHeaders = true,
    headerFormat = 'draft-7',
    skip,
    skipPaths,
    skipMethods,
    onDeny,
    statusCode = 429,
    message,
  } = config

  return (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void => {
    if (skipPaths || skipMethods) {
      const path = req.path ?? req.url?.split('?')[0] ?? '/'
      const method = req.method ?? 'GET'
      if (shouldSkip(path, method, { skipPaths, skipMethods })) {
        next()
        return
      }
    }

    if (skip?.(req)) {
      next()
      return
    }

    const resolvedKey = keyResolver ? keyResolver(req) : (req.ip ?? 'unknown')
    const resolvedCost = typeof cost === 'function' ? cost(req) : cost

    void (async () => {
      try {
        const result = await resolvedLimiter.check(resolvedKey, { cost: resolvedCost })

        if (res.headersSent) {
          next()
          return
        }

        // Set headers
        if (includeHeaders) {
          const rateLimitHeaders = toHeaders(result, { format: headerFormat })
          res.set(rateLimitHeaders)
        }

        if (result.allowed) {
          // Expose result to downstream handlers
          ;(req as unknown as Record<string, unknown>).rateLimitResult = result
          next()
          return
        }

        // Denied
        if (res.headersSent) return

        if (onDeny) {
          onDeny(req, res, result)
          return
        }

        const body = message
          ? typeof message === 'function'
            ? message(result)
            : { error: message }
          : toErrorBody(result)

        res.status(statusCode).json(body)
      } catch (err) {
        next(err)
      }
    })()
  }
}

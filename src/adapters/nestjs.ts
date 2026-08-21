import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── NestJS Types ────────────────────────────────────────────────────────────
// Minimal interfaces - users provide the actual NestJS types

export interface NestExecutionContext {
  switchToHttp(): {
    getRequest(): NestRequest
    getResponse(): NestResponse
  }
  getHandler(): unknown
  getClass(): unknown
}

export interface NestRequest {
  ip?: string | undefined
  headers: Record<string, string | string[] | undefined>
  method?: string | undefined
  url?: string | undefined
}

export interface NestResponse {
  status(code: number): NestResponse
  setHeader(name: string, value: string): NestResponse
  json(body: unknown): void
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface NestThrottleConfig {
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
  /** Key resolver. Default: request IP */
  key?: ((req: NestRequest) => string) | undefined
  /** Cost per request. Default: 1 */
  cost?: number | ((req: NestRequest) => number) | undefined
  /** Whether to set rate limit headers. Default: true */
  headers?: boolean | undefined
  /** Header format. Default: 'draft-7' */
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  /** Skip check function */
  skip?: ((req: NestRequest) => boolean) | undefined
  /** Custom deny handler */
  onDeny?: ((req: NestRequest, res: NestResponse, result: RateLimitResult) => void) | undefined
  /** HTTP status code for rate limited responses. Default: 429 */
  statusCode?: number | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(
  input: NestThrottleConfig | string,
): NestThrottleConfig & { limiter: Limiter } {
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

// ─── Guard Factory ───────────────────────────────────────────────────────────

/**
 * Creates a NestJS-compatible guard object for rate limiting.
 *
 * Usage in NestJS:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/nestjs'
 *
 * const guard = rateLimit('100/minute')
 *
 * @Injectable()
 * export class RateLimitGuard implements CanActivate {
 *   private guard = rateLimit({ limiter })
 *
 *   canActivate(context: ExecutionContext): Promise<boolean> {
 *     return this.guard.canActivate(context as any)
 *   }
 * }
 * ```
 */
export function rateLimit(config: NestThrottleConfig | string): {
  canActivate(context: NestExecutionContext): Promise<boolean>
} {
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
    statusCode = 429,
  } = resolved

  return {
    async canActivate(context: NestExecutionContext): Promise<boolean> {
      const http = context.switchToHttp()
      const req = http.getRequest()
      const res = http.getResponse()

      if (skipPaths || skipMethods) {
        const path = (req.url ?? '/').split('?')[0] || '/'
        const method = req.method ?? 'GET'
        if (shouldSkip(path, method, { skipPaths, skipMethods })) return true
      }

      if (skip?.(req)) return true

      const resolvedKey = keyResolver ? keyResolver(req) : (req.ip ?? 'unknown')
      const resolvedCost = typeof cost === 'function' ? cost(req) : cost

      const result = await limiter.check(resolvedKey, { cost: resolvedCost })

      // Set headers
      if (includeHeaders) {
        const rateLimitHeaders = toHeaders(result, { format: headerFormat })
        for (const [name, value] of Object.entries(rateLimitHeaders)) {
          res.setHeader(name, value)
        }
      }

      if (result.allowed) return true

      // Denied
      if (onDeny) {
        onDeny(req, res, result)
        return false
      }

      const body = toErrorBody(result)
      res.status(statusCode).json(body)
      return false
    },
  }
}

// ─── Decorator Metadata Helpers ──────────────────────────────────────────────

const THROTTLE_KEY = 'throtto:throttle'
const SKIP_THROTTLE_KEY = 'throtto:skip'

/**
 * Metadata for @Throttle decorator.
 * Store as class/method metadata for the guard to read.
 */
export interface ThrottleMetadata {
  limit?: number | undefined
  window?: string | undefined
  cost?: number | undefined
}

/**
 * Creates metadata setter for a @Throttle()-like decorator.
 * Users wire this into their NestJS decorator:
 *
 * ```ts
 * import { SetMetadata } from '@nestjs/common'
 * import { getThrottleMetadataKey } from 'throtto/adapters/nestjs'
 *
 * export const Throttle = (meta: ThrottleMetadata) =>
 *   SetMetadata(getThrottleMetadataKey(), meta)
 * ```
 */
export function getThrottleMetadataKey(): string {
  return THROTTLE_KEY
}

/**
 * Creates metadata setter for a @SkipThrottle()-like decorator.
 */
export function getSkipThrottleMetadataKey(): string {
  return SKIP_THROTTLE_KEY
}

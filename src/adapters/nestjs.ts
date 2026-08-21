import type { Limiter, RateLimitResult } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'

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
  /** The rate limiter instance */
  limiter: Limiter
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

// ─── Guard Factory ───────────────────────────────────────────────────────────

/**
 * Creates a NestJS-compatible guard function for rate limiting.
 *
 * Usage in NestJS:
 * ```ts
 * import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
 * import { createThrottleGuard } from 'throtto/adapters/nestjs'
 *
 * @Injectable()
 * export class RateLimitGuard implements CanActivate {
 *   private guard = createThrottleGuard({ limiter })
 *
 *   canActivate(context: ExecutionContext): Promise<boolean> {
 *     return this.guard(context as any)
 *   }
 * }
 * ```
 */
export function createThrottleGuard(
  config: NestThrottleConfig,
): (context: NestExecutionContext) => Promise<boolean> {
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
  } = config

  return async (context: NestExecutionContext): Promise<boolean> => {
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

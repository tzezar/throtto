import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Fastify Types ───────────────────────────────────────────────────────────
// Minimal types compatible with Fastify

export interface FastifyRequest {
  ip: string
  headers: Record<string, string | string[] | undefined>
  method: string
  url: string
}

export interface FastifyReply {
  code(statusCode: number): FastifyReply
  header(name: string, value: string): FastifyReply
  headers(values: Record<string, string>): FastifyReply
  send(payload: unknown): FastifyReply
  sent: boolean
}

export interface FastifyInstance {
  addHook(
    name: 'onRequest',
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  ): void
  decorate(name: string, value: unknown): void
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface FastifyAdapterConfig {
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
  /** Key resolver. Default: request.ip */
  key?: ((req: FastifyRequest) => string) | undefined
  /** Cost per request. Default: 1 */
  cost?: number | ((req: FastifyRequest) => number) | undefined
  /** Whether to set rate limit headers. Default: true */
  headers?: boolean | undefined
  /** Header format. Default: 'draft-7' */
  headerFormat?: HeaderFormat | undefined
  /** Paths to skip rate limiting for. Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
  /** Skip rate limiting for matching requests */
  skip?: ((req: FastifyRequest) => boolean) | undefined
  /** Custom deny handler */
  onDeny?: ((req: FastifyRequest, reply: FastifyReply, result: RateLimitResult) => void) | undefined
  /** HTTP status code for rate limited responses. Default: 429 */
  statusCode?: number | undefined
}

// ─── Resolve Config ──────────────────────────────────────────────────────────

function resolveConfig(input: FastifyAdapterConfig | string): FastifyAdapterConfig {
  if (typeof input === 'string') {
    return { limiter: createInternalLimiter(input) }
  }
  return input
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Creates a Fastify route-level rate limit handler (preHandler).
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/fastify'
 *
 * fastify.get('/api/search', {
 *   preHandler: rateLimit('100/minute')
 * }, handler)
 *
 * // Or with full config:
 * fastify.get('/api/search', {
 *   preHandler: rateLimit({ limiter, key: (req) => req.ip })
 * }, handler)
 * ```
 */
export function rateLimit(
  config: FastifyAdapterConfig | string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const resolved = resolveConfig(config)

  if (!resolved.limiter && resolved.limit === undefined) {
    throw new ConfigError('Either "limiter" or "limit" (with "window") must be provided.')
  }

  if (!resolved.limiter && resolved.limit !== undefined && resolved.window === undefined) {
    throw new ConfigError(
      "'window' is required when using inline rate limit config. Example: { limit: 100, window: '1m' }",
    )
  }

  const resolvedLimiter =
    resolved.limiter ??
    createInternalLimiter({
      limit: resolved.limit!,
      window: resolved.window!,
      algorithm: resolved.algorithm,
      store: resolved.store,
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
  } = resolved

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (skipPaths || skipMethods) {
      const path = request.url.split('?')[0] || '/'
      if (shouldSkip(path, request.method, { skipPaths, skipMethods })) return
    }

    if (skip?.(request)) return

    const resolvedKey = keyResolver ? keyResolver(request) : request.ip
    const resolvedCost = typeof cost === 'function' ? cost(request) : cost

    const result = await resolvedLimiter.check(resolvedKey, { cost: resolvedCost })

    if (includeHeaders) {
      const rateLimitHeaders = toHeaders(result, { format: headerFormat })
      reply.headers(rateLimitHeaders)
    }

    if (result.allowed) {
      // Expose result to downstream handlers
      ;(request as unknown as Record<string, unknown>).rateLimitResult = result
      return
    }

    if (onDeny) {
      onDeny(request, reply, result)
      return
    }

    const body = toErrorBody(result)
    reply.code(statusCode).send(body)
  }
}

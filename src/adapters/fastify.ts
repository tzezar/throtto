import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { toErrorBody, toHeaders } from '../http/headers.js'
import type { HeaderFormat } from '../http/headers.js'
import { shouldSkip } from '../http/skip.js'
import { rateLimit } from '../limiter/presets.js'

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

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Creates a Fastify rate limit plugin.
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto'
 * import { fastifyRateLimit } from 'throtto/adapters/fastify'
 *
 * const limiter = rateLimit('100/minute')
 * fastify.register(fastifyRateLimit({ limiter }))
 * ```
 */
export function fastifyRateLimit(config: FastifyAdapterConfig): (fastify: FastifyInstance) => void {
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
  } = config

  return (fastify: FastifyInstance): void => {
    fastify.addHook(
      'onRequest',
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        if (skipPaths || skipMethods) {
          const path = request.url.split('?')[0] || '/'
          if (shouldSkip(path, request.method, { skipPaths, skipMethods })) return
        }

        if (skip?.(request)) return

        const resolvedKey = keyResolver ? keyResolver(request) : request.ip
        const resolvedCost = typeof cost === 'function' ? cost(request) : cost

        const result = await resolvedLimiter.check(resolvedKey, { cost: resolvedCost })

        // Set headers
        if (includeHeaders) {
          const rateLimitHeaders = toHeaders(result, { format: headerFormat })
          reply.headers(rateLimitHeaders)
        }

        if (result.allowed) {
          // Expose result to downstream handlers
          ;(request as unknown as Record<string, unknown>).rateLimitResult = result
          return
        }

        // Denied
        if (onDeny) {
          onDeny(request, reply, result)
          return
        }

        const body = toErrorBody(result)
        reply.code(statusCode).send(body)
      },
    )
  }
}

/**
 * Route-level rate limiting for Fastify.
 * Use this as a preHandler for specific routes.
 *
 * Usage:
 * ```ts
 * fastify.get('/api/search', {
 *   preHandler: fastifyRouteRateLimit({ limiter })
 * }, handler)
 * ```
 */
export function fastifyRouteRateLimit(
  config: FastifyAdapterConfig,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
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
  } = config

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

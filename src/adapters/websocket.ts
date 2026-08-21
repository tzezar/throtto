import { ConfigError } from '../core/errors.js'
import type { Duration, Limiter, RateLimitResult, Store } from '../core/types.js'
import { rateLimit as createInternalLimiter } from '../limiter/presets.js'

// ─── Config ──────────────────────────────────────────────────────────────────

export interface WebSocketAdapterConfig {
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
  /** Key resolver for the connection/message */
  key: (info: WebSocketInfo) => string
  /** Cost per message. Default: 1 */
  cost?: number | ((info: WebSocketInfo) => number) | undefined
  /** Paths to skip rate limiting for. Note: Not applicable for WebSocket - path/method skip is not supported. */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Note: Not applicable for WebSocket - path/method skip is not supported. */
  skipMethods?: string[] | undefined
}

export interface WebSocketInfo {
  /** Client identifier (IP, user ID, connection ID, etc.) */
  id?: string | undefined
  /** The WebSocket message data (if per-message limiting) */
  message?: unknown | undefined
  /** Request headers from the upgrade request */
  headers?: Record<string, string | undefined> | undefined
  /** Remote address */
  remoteAddress?: string | undefined
}

export interface WebSocketCheckResult {
  allowed: boolean
  result: RateLimitResult
  /** Suggested action when denied */
  action: 'allow' | 'drop' | 'close' | 'backpressure'
}

// ─── Limiter ─────────────────────────────────────────────────────────────────

/**
 * Creates a WebSocket rate limit checker.
 *
 * Note: String presets are NOT supported for WebSocket because `key` is required.
 *
 * Unlike HTTP adapters, this doesn't send responses - it returns a result
 * that the application decides how to handle (drop message, close connection, etc.)
 *
 * Usage:
 * ```ts
 * import { rateLimit } from 'throtto/adapters/websocket'
 * import { rateLimit as createLimiter } from 'throtto'
 *
 * const wsLimiter = rateLimit({
 *   limiter: createLimiter('50/second'),
 *   key: (info) => info.remoteAddress ?? 'unknown',
 * })
 *
 * ws.on('message', async (data) => {
 *   const check = await wsLimiter.checkMessage({ remoteAddress: ws.remoteAddress, message: data })
 *   if (!check.allowed) {
 *     if (check.action === 'close') ws.close(1008, 'Rate limited')
 *     return
 *   }
 *   // process message
 * })
 * ```
 */
export function rateLimit(config: WebSocketAdapterConfig): {
  /** Check rate limit for a connection attempt */
  checkConnection: (info: WebSocketInfo) => Promise<WebSocketCheckResult>
  /** Check rate limit for an individual message */
  checkMessage: (info: WebSocketInfo) => Promise<WebSocketCheckResult>
  /** Reset rate limit state for a connection */
  reset: (info: WebSocketInfo) => Promise<void>
} {
  const limiter =
    config.limiter ??
    (() => {
      if (config.limit === undefined) {
        throw new ConfigError('Either "limiter" or "limit" (with "window") must be provided.')
      }
      if (config.window === undefined) {
        throw new ConfigError(
          "'window' is required when using inline config. Example: { limit: 100, window: '1m' }",
        )
      }
      return createInternalLimiter({
        limit: config.limit,
        window: config.window,
        algorithm: config.algorithm,
        store: config.store,
      })
    })()

  const { key: keyResolver, cost } = config

  function resolveKey(info: WebSocketInfo): string {
    return keyResolver(info)
  }

  function resolveCost(info: WebSocketInfo): number | undefined {
    if (typeof cost === 'function') return cost(info)
    return cost
  }

  function determineAction(result: RateLimitResult): WebSocketCheckResult['action'] {
    if (result.allowed) return 'allow'
    // If severely over limit (0 remaining), suggest close
    if (result.remaining <= 0) {
      const retryAfter = !result.allowed && 'retryAfter' in result ? result.retryAfter : 0
      if (retryAfter > 60_000) return 'close'
    }
    return 'drop'
  }

  return {
    async checkConnection(info: WebSocketInfo): Promise<WebSocketCheckResult> {
      const key = `conn:${resolveKey(info)}`
      const result = await limiter.check(key, { cost: resolveCost(info) })
      return {
        allowed: result.allowed,
        result,
        action: result.allowed ? 'allow' : 'close',
      }
    },

    async checkMessage(info: WebSocketInfo): Promise<WebSocketCheckResult> {
      const key = `msg:${resolveKey(info)}`
      const result = await limiter.check(key, { cost: resolveCost(info) })
      return {
        allowed: result.allowed,
        result,
        action: determineAction(result),
      }
    },

    async reset(info: WebSocketInfo): Promise<void> {
      const key = resolveKey(info)
      await limiter.reset(`conn:${key}`)
      await limiter.reset(`msg:${key}`)
    },
  }
}

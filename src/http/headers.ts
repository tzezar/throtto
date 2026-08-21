import type { RateLimitResult } from '../core/types.js'

// ─── Header Format ───────────────────────────────────────────────────────────

export type HeaderFormat = 'draft-7' | 'draft-6' | 'legacy'

export interface HeaderOptions {
  /** Header format to use. Default: 'draft-7' */
  format?: HeaderFormat | undefined
  /** Whether to include Retry-After on deny. Default: true */
  includeRetryAfter?: boolean | undefined
}

// ─── Header Generation ───────────────────────────────────────────────────────

/**
 * Converts a rate limit result to HTTP headers.
 *
 * Supports three formats:
 * - 'draft-7' (default): Uses RateLimit-Policy, RateLimit (combined header per IETF RFC 9309)
 * - 'draft-6': Uses RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
 * - 'legacy': Uses X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 */
export function toHeaders(
  result: RateLimitResult,
  options: HeaderOptions = {},
): Record<string, string> {
  const { format = 'draft-7', includeRetryAfter = true } = options
  const headers: Record<string, string> = {}

  const resetSeconds = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))

  switch (format) {
    case 'draft-7': {
      // RFC 9309 - RateLimit Fields
      // RateLimit-Policy omitted: we don't have the window duration, only time-until-reset
      headers.RateLimit = `limit=${result.limit}, remaining=${Math.max(0, result.remaining)}, reset=${resetSeconds}`
      break
    }
    case 'draft-6': {
      headers['RateLimit-Limit'] = String(result.limit)
      headers['RateLimit-Remaining'] = String(Math.max(0, result.remaining))
      headers['RateLimit-Reset'] = String(resetSeconds)
      break
    }
    case 'legacy': {
      headers['X-RateLimit-Limit'] = String(result.limit)
      headers['X-RateLimit-Remaining'] = String(Math.max(0, result.remaining))
      headers['X-RateLimit-Reset'] = String(resetSeconds)
      break
    }
  }

  // Add Retry-After on deny
  if (!result.allowed && includeRetryAfter) {
    const retryAfter = 'retryAfter' in result ? result.retryAfter : resetSeconds * 1000
    headers['Retry-After'] = String(Math.ceil(retryAfter / 1000))
  }

  return headers
}

// ─── Error Body ─────────────────────────────────────────────────────────────

export interface ErrorBodyOptions {
  /** Error body format. Default: 'simple' */
  format?: 'simple' | 'rfc7807' | undefined
}

/**
 * Creates a standard 429 response body.
 *
 * Supports two formats:
 * - 'simple' (default): `{ error, message, retryAfter }`
 * - 'rfc7807': RFC 7807 Problem Details `{ type, title, status, detail, retryAfter }`
 */
export function toErrorBody(
  result: RateLimitResult,
  options?: ErrorBodyOptions,
): Record<string, unknown> {
  const retryAfter =
    !result.allowed && 'retryAfter' in result
      ? Math.ceil(result.retryAfter / 1000)
      : Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))

  const format = options?.format ?? 'simple'

  if (format === 'rfc7807') {
    return {
      type: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429',
      title: 'Too Many Requests',
      status: 429,
      detail: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      retryAfter,
    }
  }

  return {
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
    retryAfter,
  }
}

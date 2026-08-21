// ─── Key Resolver Types ──────────────────────────────────────────────────────

/**
 * A key resolver extracts a rate limit key from a generic request-like object.
 * The generic parameter allows framework-specific request types.
 */
export type KeyResolver<TRequest = unknown> = (req: TRequest) => string

// ─── Common Header Names for IP Extraction ───────────────────────────────────

const IP_HEADERS = [
  'cf-connecting-ip', // Cloudflare
  'x-real-ip', // Nginx
  'x-forwarded-for', // Standard proxy
  'x-client-ip', // Apache
  'true-client-ip', // Akamai
  'fastly-client-ip', // Fastly
] as const

// ─── Built-in Key Resolvers ──────────────────────────────────────────────────

/**
 * Resolves key by client IP address.
 * Checks common proxy headers, falls back to connection info.
 *
 * Works with any request object that has a `headers` property
 * (Fetch Request, Express req, Hono Context, etc.)
 */
export function byIp<TRequest extends { headers: HeadersLike; ip?: string | undefined }>(options?: {
  trustProxy?: boolean | undefined
  trustDepth?: number | undefined
}): KeyResolver<TRequest> {
  const trustProxy = options?.trustProxy ?? true
  const trustDepth = options?.trustDepth ?? 1

  return (req: TRequest): string => {
    if (trustProxy) {
      const headers = req.headers
      for (const name of IP_HEADERS) {
        const value = getHeader(headers, name)
        if (value) {
          if (name === 'x-forwarded-for') {
            // X-Forwarded-For may contain multiple IPs; take from the right
            // based on trustDepth to avoid client-supplied spoofing.
            // trustDepth=1 → rightmost (the one your reverse proxy added)
            // trustDepth=2 → second from right (actual client behind one proxy)
            const parts = value.split(',')
            const index = parts.length - trustDepth
            if (index < 0) {
              // Not enough proxy hops - skip this header, try next
              continue
            }
            const ip = parts[index]?.trim()
            if (ip) return ip
          } else {
            // Single-value proxy headers (cf-connecting-ip, x-real-ip, etc.)
            // trustDepth doesn't apply - use the value directly
            const ip = value.trim()
            if (ip) return ip
          }
        }
      }
    }

    // Fallback to direct IP property (Express, Fastify)
    if (req.ip) return req.ip

    return 'unknown'
  }
}

/**
 * Resolves key by authenticated user identifier.
 * Requires a function to extract user ID from the request.
 */
export function byUser<TRequest>(
  getUserId: (req: TRequest) => string | null | undefined,
): KeyResolver<TRequest> {
  return (req: TRequest): string => {
    const userId = getUserId(req)
    return userId ? `user:${userId}` : 'anonymous'
  }
}

/**
 * Resolves key by API key from header or query parameter.
 */
export function byApiKey<
  TRequest extends { headers: HeadersLike; url?: string | undefined },
>(options?: {
  header?: string | undefined
  query?: string | undefined
}): KeyResolver<TRequest> {
  const headerName = options?.header ?? 'x-api-key'
  const queryParam = options?.query ?? 'api_key'

  return (req: TRequest): string => {
    // Check header first
    const headerValue = getHeader(req.headers, headerName)
    if (headerValue) return `apikey:${headerValue}`

    // Check query parameter
    if (req.url) {
      try {
        const url = new URL(req.url, 'http://localhost')
        const queryValue = url.searchParams.get(queryParam)
        if (queryValue) return `apikey:${queryValue}`
      } catch {
        // Invalid URL, skip
      }
    }

    return 'apikey:unknown'
  }
}

/**
 * Combines multiple key resolvers into a composite key.
 * Useful for per-user-per-endpoint or per-ip-per-route limiting.
 */
export function byComposite<TRequest>(
  ...resolvers: KeyResolver<TRequest>[]
): KeyResolver<TRequest> {
  if (resolvers.length === 0) {
    throw new Error('byComposite requires at least one key resolver.')
  }
  return (req: TRequest): string => {
    return resolvers.map((r) => r(req)).join(':')
  }
}

/**
 * Creates a custom key resolver from a function.
 */
export function byCustom<TRequest>(resolver: (req: TRequest) => string): KeyResolver<TRequest> {
  return resolver
}

/**
 * Resolves key by request path/route.
 */
export function byPath<TRequest extends { url?: string | undefined }>(options?: {
  includeMethod?: boolean | undefined
}): KeyResolver<TRequest & { method?: string | undefined }> {
  const includeMethod = options?.includeMethod ?? false

  return (req): string => {
    let path = '/'
    if (req.url) {
      try {
        const url = new URL(req.url, 'http://localhost')
        path = url.pathname
      } catch {
        path = req.url
      }
    }

    if (includeMethod && req.method) {
      return `${req.method}:${path}`
    }
    return path
  }
}

// ─── Header Utilities ────────────────────────────────────────────────────────

type HeadersLike =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>

function getHeader(headers: HeadersLike, name: string): string | null {
  if ('get' in headers && typeof headers.get === 'function') {
    return headers.get(name)
  }

  // Plain object headers (Express, Fastify)
  const record = headers as Record<string, string | string[] | undefined>
  const value = record[name] ?? record[name.toLowerCase()]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

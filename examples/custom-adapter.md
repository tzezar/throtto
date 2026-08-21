# Writing a Custom Adapter

Throtto ships 18 framework adapters, but if yours isn't covered, here's how to write one. It's ~30 lines.

## The pattern

Every adapter follows the same steps:

1. **Skip** - check if this request should bypass rate limiting
2. **Key** - resolve the rate limit key from the request
3. **Check** - call the limiter
4. **Headers** - generate standard rate limit headers
5. **Allow or deny** - pass through or return 429

## Example: generic HTTP adapter

```ts
import type { Limiter } from '@tzezar/throtto'
import { toHeaders, toErrorBody } from '@tzezar/throtto/http'
import { shouldSkip } from '@tzezar/throtto/http'

interface AdapterConfig {
  limiter: Limiter
  key?: (req: Request) => string
  skipPaths?: string[]
  skipMethods?: string[]
}

export function myAdapter(config: AdapterConfig) {
  const { limiter, key, skipPaths, skipMethods } = config

  return async (req: Request): Promise<Response | null> => {
    // 1. Skip
    const url = new URL(req.url)
    if (shouldSkip(url.pathname, req.method, { skipPaths, skipMethods })) {
      return null  // pass through
    }

    // 2. Key
    const resolvedKey = key
      ? key(req)
      : req.headers.get('x-forwarded-for') ?? 'unknown'

    // 3. Check
    const result = await limiter.check(resolvedKey)

    // 4. Headers
    const headers = toHeaders(result)

    // 5. Allow or deny
    if (result.allowed) {
      return null  // pass through, merge headers into response
    }

    return new Response(JSON.stringify(toErrorBody(result)), {
      status: 429,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  }
}
```

## Key utilities

| Utility | Import | Purpose |
|---|---|---|
| `shouldSkip(path, method, config)` | `@tzezar/throtto/http` | Check if request matches skipPaths/skipMethods |
| `toHeaders(result, { format? })` | `@tzezar/throtto/http` | Generate RFC 9309 / draft-6 / legacy headers |
| `toErrorBody(result, { format? })` | `@tzezar/throtto/http` | Generate simple or RFC 7807 error body |

## Header formats

```ts
toHeaders(result)                          // draft-7 (RFC 9309) - default
toHeaders(result, { format: 'draft-6' })   // draft-6
toHeaders(result, { format: 'legacy' })    // X-RateLimit-* headers
```

## Error body formats

```ts
toErrorBody(result)                         // { error: 'Too Many Requests', message: 'Rate limit exceeded...', retryAfter: 58 }
toErrorBody(result, { format: 'rfc7807' })  // RFC 7807 Problem Details
```

## Framework-specific tips

- **Express/Connect**: Return `(req, res, next) => void`. Call `next()` on allow, `res.status(429).json(...)` on deny.
- **Fastify**: Return `(request, reply) => void`. Use `reply.code(429).send(...)` on deny.
- **Koa**: Return `async (ctx, next) => void`. Set `ctx.status = 429` on deny.
- **Hono**: Return a Hono middleware. Use `c.json(body, 429)` on deny.
- **Serverless (Lambda/Workers)**: Return the 429 Response directly.

---

Next: [All 18 built-in adapters](../docs/adapters.md) · [HTTP utilities](../docs/http.md)

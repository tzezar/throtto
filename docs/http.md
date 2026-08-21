# HTTP Utilities

Throtto provides standards-compliant HTTP helpers for headers, error bodies, key extraction, and path skipping.

## Response Headers

```ts
import { toHeaders } from '@tzezar/throtto/http'

const result = await limiter.check('user-123')
const headers = toHeaders(result)
```

### Formats

**draft-7 (RFC 9309)** - default, current standard:
```
RateLimit: limit=100, remaining=95, reset=58
```

**draft-6**:
```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 58
```

**legacy** (X-RateLimit-* - widely used but non-standard):
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 58
```

```ts
const d7 = toHeaders(result)                         // default: draft-7
const d6 = toHeaders(result, { format: 'draft-6' })
const legacy = toHeaders(result, { format: 'legacy' })
```

## Error Bodies

```ts
import { toErrorBody } from '@tzezar/throtto/http'

// Simple (default)
const body = toErrorBody(result)
// { error: 'Too Many Requests', message: 'Rate limit exceeded. Try again in 58 seconds.', retryAfter: 58 }

// RFC 7807 Problem Details
const rfc7807 = toErrorBody(result, { format: 'rfc7807' })
// { type: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429', title: 'Too Many Requests', status: 429, detail: '...', ... }
```

## Key Resolvers

Framework-agnostic functions that extract a rate limit key from a request object.

```ts
import { byIp, byUser, byApiKey, byComposite, byCustom, byPath } from '@tzezar/throtto/http'
```

### byIp

```ts
// Basic
const resolver = byIp()

// With proxy trust depth (IMPORTANT for security)
const resolver = byIp({ trustDepth: 1 })
// trustDepth: 1 = trust last proxy (rightmost X-Forwarded-For)
// trustDepth: 2 = trust last 2 proxies
// Prevents spoofing via leftmost IP injection
```

### byUser

```ts
const resolver = byUser((req) => req.userId)
```

### byApiKey

```ts
const resolver = byApiKey()                          // default: X-API-Key header
const resolver = byApiKey({ header: 'Authorization' })
const resolver = byApiKey({ query: 'api_key' })
```

### byPath

```ts
const resolver = byPath()                            // just path
const resolver = byPath({ includeMethod: true })     // "GET:/api/users"
```

### byComposite

Combine multiple resolvers:
```ts
const resolver = byComposite(byUser(getUserId), byIp({ trustDepth: 1 }))
// Concatenates all resolvers with `:` separator, e.g. "user-123:192.168.1.1"
```

### byCustom

```ts
const resolver = byCustom((req) => req.headers['x-tenant-id'] ?? 'default')
```

## Path & Method Skipping

```ts
import { shouldSkip } from '@tzezar/throtto/http'

shouldSkip('/health', 'GET', { skipPaths: ['/health', '/metrics'] })  // true
shouldSkip('/api/users', 'OPTIONS', { skipMethods: ['OPTIONS'] })     // true
shouldSkip('/api/users', 'GET', { skipPaths: ['/health'] })           // false
```

All adapters accept `skipPaths` and `skipMethods` directly.

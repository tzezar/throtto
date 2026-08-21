# Basic Rate Limiting

The simplest way to get started with throtto.

## String preset

The fastest way - one function, one string:

```ts
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
```

Supported units: `second`, `minute`, `hour`, `day` (or `s`, `m`, `h`, `d`).

```ts
rateLimit('10/second')
rateLimit('1000/hour')
rateLimit('50000/day')
```

## Object config

More control - pick an algorithm, add a store, configure behavior:

```ts
const limiter = rateLimit({
  limit: 100,
  window: '1m',
  algorithm: 'token-bucket',  // default: 'sliding-window-counter'
})
```

All 7 algorithms: `fixed-window`, `sliding-window-counter`, `sliding-window-log`, `token-bucket`, `leaky-bucket`, `gcra`, `concurrency`.

## Checking a key

```ts
const result = await limiter.check('user-123')

if (result.allowed) {
  console.log(`Remaining: ${result.remaining}/${result.limit}`)
  // proceed with request
} else {
  console.log(`Denied. Retry in ${result.retryAfter}ms`)
  // reject or queue the request
}
```

Every check returns a `RateLimitResult`:
- **Allowed**: `{ allowed: true, limit, remaining, resetAt, cost }`
- **Denied**: `{ allowed: false, limit, remaining, resetAt, retryAfter, cost }`

## Consume (throw on deny)

If you prefer exceptions over conditionals:

```ts
import { RateLimitExceededError } from '@tzezar/throtto'

try {
  const allowed = await limiter.consume('user-123')
  console.log(`Consumed. Remaining: ${allowed.remaining}`)
} catch (err) {
  if (err instanceof RateLimitExceededError) {
    console.log(`Rate limited. Retry in ${err.retryAfter}ms`)
  }
}
```

## Peek (don't consume)

Check current state without counting as a request:

```ts
const info = await limiter.peek('user-123')
// { limit: 100, remaining: 95, resetAt: 1724263260000 } or null
```

## Reset a key

Clear all rate limit state for a key:

```ts
await limiter.reset('user-123')
```

## Weighted requests (cost)

Some requests are more expensive than others:

```ts
const result = await limiter.check('user-123', { cost: 5 })
// Consumes 5 units instead of 1
```

## Key normalization

Prevent duplicate keys from casing or whitespace:

```ts
const limiter = rateLimit({
  limit: 100,
  window: '1m',
  normalizeKey: 'lowercase',  // 'User-123' → 'user-123'
})
```

Options: `'lowercase'`, `'trim'`, `'lowercase-trim'`, or a custom function.

## Fail mode

Control behavior when the store is unavailable:

```ts
const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: redisStore({ client }),
  failMode: 'open',           // allow on store failure (default: 'open')
  fallbackStore: memoryStore(), // optional local fallback
})
```

## Shutdown

Clean up when your process exits:

```ts
await limiter.shutdown({ timeout: 5000 })
```

---

Next: [Express integration](./express.md) · [All algorithms](../docs/algorithms.md)

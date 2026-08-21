# throtto Documentation

> Comprehensive, framework-agnostic TypeScript rate limiting.

## Concepts

throtto has a layered architecture. Understanding the layers helps you pick the right tool:

```
Request
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ Adapter (optional)                                       │
│ Extracts key from request, sets response headers,        │
│ returns 429 on deny. Framework-specific.                 │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ Limiter                                                  │
│ Orchestrates algorithm + store. Handles fail modes,      │
│ key normalization, hooks. The core unit.                  │
└────────────┬──────────────────────────┬─────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐  ┌────────────────────────────┐
│ Algorithm              │  │ Store                       │
│ Pure logic: decides    │  │ Persists state (memory,     │
│ allow/deny from state  │  │ Redis, Postgres, etc.)      │
└────────────────────────┘  └────────────────────────────┘
```

- **Algorithm** — stateless decision function. Given current state + timestamp, returns allow/deny + new state.
- **Store** — persists algorithm state between checks. Swap stores without changing any other code.
- **Limiter** — wires algorithm + store together. This is what you call `.check(key)` on.
- **Adapter** — bridges a Limiter to a specific framework (Express middleware, NestJS guard, etc.). Optional — you can always use the Limiter directly.

## `rateLimit` vs `createLimiter`

Both create a `Limiter`. The difference is in what you control:

| | `rateLimit` | `createLimiter` |
|---|---|---|
| **String presets** | ✅ `'100/minute'` | ✅ `'100/minute'` |
| **Object config** | ✅ `{ limit, window, algorithm?, store? }` | ✅ Full `LimiterConfig` |
| **Algorithm instances** | ❌ Only by name (`'token-bucket'`) | ✅ `tokenBucket({ capacity: 50, refillRate: 10 })` |
| **Hooks** | ❌ | ✅ `onAllow`, `onDeny`, `onError` |
| **Key prefix** | ❌ | ✅ `prefix: 'api:'` |
| **Key normalization** | ✅ | ✅ |
| **When to use** | Quick setup, inline adapter config | Full control, custom algorithm params, hooks |

**Rule of thumb:** Start with `rateLimit`. Switch to `createLimiter` when you need hooks, a key prefix, or fine-grained algorithm parameters (e.g. token bucket with specific `refillRate`).

When you also import `rateLimit` from an adapter in the same file, use `createLimiter` for the core limiter to avoid name collision:

```ts
import { createLimiter, pipe, withAllowlist } from '@tzezar/throtto'
import { rateLimit } from '@tzezar/throtto/adapters/express'

const limiter = pipe(
  createLimiter('1000/hour'),
  withAllowlist({ allowlist: ['admin'] })
)

app.use(rateLimit({ limiter }))
```

## String Preset Format

> **⚠️ Limitation:** String presets only support `{number}/{unit}` where unit is one of: `second` (`s`), `minute` (`m`), `hour` (`h`), `day` (`d`).
>
> ✅ `'100/minute'`, `'10/s'`, `'1000/h'`, `'5000/day'`
> ❌ `'100/15m'`, `'50/30s'` — custom windows don't work as strings
>
> For custom windows, use the object form: `{ limit: 100, window: '15m' }`

## Error Handling & Resilience

### Fail modes

What happens when the store is unreachable (Redis down, network partition)?

```ts
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: redisStore({ client }),

  // 'open' (default) — allow requests when store fails (safe for availability)
  // 'closed' — deny requests when store fails (safe for security)
  failMode: 'open',

  // Optional: fall back to a local store instead of blindly allowing/denying
  fallbackStore: memoryStore(),
})
```

| `failMode` | Store down behavior | Best for |
|---|---|---|
| `'open'` (default) | Allow all requests | APIs where availability > strict enforcement |
| `'closed'` | Deny all requests | Security-critical endpoints (auth, payments) |

### Fallback store

When `fallbackStore` is set and the primary store errors:
1. The limiter switches to the fallback store for that check
2. The `onStoreError` hook fires (if configured via `createLimiter`)
3. Subsequent checks retry the primary store first

```ts
import { createLimiter, memoryStore } from '@tzezar/throtto'
import { redisStore } from '@tzezar/throtto/stores/redis'

const limiter = createLimiter({
  algorithm: 'sliding-window-counter',
  limit: 100,
  window: '1m',
  store: redisStore({ client }),
  fallbackStore: memoryStore(),
  hooks: {
    onError: (key, error) => {
      console.error(`Store error for ${key}:`, error.message)
      // Alert your monitoring system
    },
  },
})
```

### Cache layer resilience

The `withCache` layer adds another resilience dimension:

```ts
import { withCache } from '@tzezar/throtto'

const store = withCache(redisStore({ client }), { localTtl: 5000 })
```

If Redis is down but a key was recently cached locally, the local cache still serves it. This provides a brief grace period during outages for hot keys.

## Guides

| Guide | What you'll learn |
|---|---|
| [Algorithms](./algorithms.md) | All 7 algorithms — when to use each, config, trade-offs |
| [Storage Adapters](./stores.md) | Memory, Redis, Upstash, PostgreSQL, MySQL, SQLite — setup & comparison |
| [Framework Adapters](./adapters.md) | Express, Fastify, Hono, Next.js + 14 more — middleware setup |
| [Composition](./composition.md) | `pipe()`, wrappers (allowlist, dry-run, override, etc.), advanced limiters |
| [Patterns](./patterns.md) | throttle, debounce, penalty box, quota, cost mapping, backpressure |
| [HTTP Utilities](./http.md) | RFC 9309 headers, error bodies, key resolvers, path skipping |
| [Testing](./testing.md) | testClock, mockStore, assertion helpers, `createTestLimiter` |
| [Analytics](./analytics.md) | Metrics collection, Prometheus/JSON/CSV export, event streaming |

## API at a Glance

### Core

| Export | Description |
|---|---|
| `rateLimit(preset, options?)` | Create a limiter from `'100/minute'` or `{ limit, window }` |
| `createLimiter(config)` | Full-control limiter builder (hooks, prefix, algorithm instances) |
| `pipe(limiter, ...transforms)` | Functional composition |
| `parseDuration(value)` | Parse `'1m'`, `'30s'`, etc. to milliseconds |
| `isLimiter(obj)` | Runtime type guard |
| `isAllowed(result)` / `isDenied(result)` | Result type guards |

### Limiter Methods

| Method | Description |
|---|---|
| `check(key, options?)` | Check + consume. Returns `AllowedResult \| DeniedResult` |
| `consume(key, options?)` | Like `check()` but throws `RateLimitExceededError` on deny |
| `peek(key)` | Check current state without consuming |
| `reset(key)` | Clear rate limit state for a key |
| `shutdown(options?)` | Clean up resources |

### Algorithms

`fixedWindow`, `slidingWindowCounter`, `slidingWindowLog`, `tokenBucket`, `leakyBucket`, `gcra`, `concurrency`

### Stores

`memoryStore`, `redisStore`, `upstashStore`, `postgresStore`, `mysqlStore`, `sqliteStore`, `withCache`

### Wrappers

`withAllowlist`, `withDryRun`, `withOverride`, `withThresholds`, `withSoftHardLimit`, `withConditional`, `withBatch`, `withGracefulShutdown`, `withAnalytics`

### Advanced Limiters

`createCompoundLimiter`, `createTieredLimiter`, `createDynamicLimiter`, `createHierarchyLimiter`, `createScheduledLimiter`, `createLazyLimiter`

### Patterns

`throttle`, `debounce`, `createPenaltyBox`, `createQuota`, `withCostMapping`, `withBackpressure`, `getBackpressure`

### HTTP

`toHeaders`, `toErrorBody`, `byIp`, `byUser`, `byApiKey`, `byComposite`, `byCustom`, `byPath`, `shouldSkip`

### Testing

`createTestLimiter`, `testClock`, `mockStore`, `assertAllowed`, `assertDenied`, `exhaust`

### Errors

`ThrottoError`, `ConfigError`, `StoreError`, `TimeoutError`, `RateLimitExceededError`

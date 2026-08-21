# throtto Documentation

> Comprehensive, framework-agnostic TypeScript rate limiting.

## Guides

| Guide | What you'll learn |
|---|---|
| [Algorithms](./algorithms.md) | All 7 algorithms - when to use each, config, trade-offs |
| [Storage Adapters](./stores.md) | Memory, Redis, Upstash, PostgreSQL, MySQL, SQLite - setup & comparison |
| [Framework Adapters](./adapters.md) | Express, Fastify, Hono, Next.js + 14 more - middleware setup |
| [Composition](./composition.md) | `pipe()`, wrappers (allowlist, dry-run, override, etc.), advanced limiters |
| [Patterns](./patterns.md) | throttle, debounce, penalty box, quota, cost mapping, backpressure |
| [HTTP Utilities](./http.md) | RFC 9309 headers, error bodies, key resolvers, path skipping |
| [Testing](./testing.md) | testClock, mockStore, assertion helpers, `createTestLimiter` |
| [Analytics](./analytics.md) | Metrics collection, Prometheus/JSON/CSV export, event streaming |

## Quick Start

```ts
import { rateLimit } from '@tzezar/throtto'

// One-liner
const limiter = rateLimit('100/minute')

// Check a key
const result = await limiter.check('user-123')
if (result.allowed) {
  // proceed
}
```

See the [main README](../README.md) for installation and more examples.

## API at a Glance

### Core

| Export | Description |
|---|---|
| `rateLimit(preset, options?)` | Create a limiter from `'100/minute'` or `{ limit, window }` |
| `createLimiter(config)` | Low-level limiter builder with full config |
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

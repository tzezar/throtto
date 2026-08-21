<div align="center">

<img alt="throtto" src="./assets/logo-with-background.png" width="400">

**Comprehensive, framework-agnostic TypeScript rate limiting.**

[![npm version](https://img.shields.io/npm/v/%40tzezar%2Fthrotto?color=blue)](https://www.npmjs.com/package/@tzezar/throtto)
[![bundle size](https://img.shields.io/bundlephobia/minzip/%40tzezar%2Fthrotto?color=green)](https://bundlephobia.com/package/@tzezar/throtto)
[![tests](https://img.shields.io/github/actions/workflow/status/tzezar/throtto/ci.yml?label=tests)](https://github.com/tzezar/throtto/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/%40tzezar%2Fthrotto)](./LICENSE)

7 algorithms · 6 stores · 18 framework adapters · Functional composition API

[Quick Start](#quick-start) · [Algorithms](#algorithms) · [Stores](#storage-adapters) · [Adapters](#framework-adapters) · [Composition](#composition) · [Benchmarks](#benchmarks) · [Docs](./docs/)

</div>

---

## Features

- 🔒 **7 algorithms** - Fixed Window, Sliding Window (Counter + Log), Token Bucket, Leaky Bucket, GCRA, Concurrency
- 🏪 **6 storage adapters** - Memory, Redis, Upstash, PostgreSQL, MySQL, SQLite
- 🔌 **18 framework adapters** - Express, Fastify, Hono, Next.js, SvelteKit, Remix, Astro, NestJS, Elysia, H3, tRPC, WebSocket, Koa, Lambda, CloudFlare Workers, Bun, Deno, Generic HTTP
- 🎯 **Functional composition** - `pipe()` limiters, wrappers, and patterns like building blocks
- 🛡️ **Production-grade** - allowlists, dry-run, overrides, thresholds, backpressure, penalty box, graceful shutdown
- 🧪 **Testing-first** - controllable clocks, mock stores, assertion helpers, one-liner `createTestLimiter`
- 📋 **Standards-compliant** - RFC 9309 (draft-7) headers, RFC 7807 error bodies
- 📊 **Built-in analytics** - Prometheus, JSON, CSV export, event streaming
- 📝 **Zero runtime dependencies** in core
- ⚡ **Tree-shakeable, ESM-only**, full TypeScript with strict types

## How throtto Compares

Compared against the 6 most popular npm rate limiting packages. ✅ = built-in, ⚠️ = partial/community, blank = not available.

**Basics**

| Feature | **throtto** | rate-limiter-flexible | express-rate-limit | @upstash/ratelimit | @nestjs/throttler | bottleneck | limiter |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Downloads/wk | new | 1.9M | 38.6M | 1.5M | 2.5M | 7.9M | 10.9M |
| Framework-agnostic | ✅ | ✅ | | ✅ | | ✅ | ✅ |
| TypeScript-first | ✅ strict | ⚠️ .d.ts only | ✅ | ✅ | ✅ | ⚠️ .d.ts only | ✅ |
| Zero runtime deps | ✅ | ✅ | | | ✅ | ✅ | ✅ |
| ESM + tree-shake | ✅ | ⚠️ CJS only | ✅ | ✅ | ✅ | ⚠️ CJS only | ✅ |
| Actively maintained | ✅ | ✅ | ✅ | ✅ | ✅ | | |

**Algorithms**

| Feature | **throtto** | rate-limiter-flexible | express-rate-limit | @upstash/ratelimit | @nestjs/throttler | bottleneck | limiter |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Fixed Window | ✅ | ✅ | ✅ | ✅ | ✅ | | |
| Sliding Window | ✅ counter+log | | | ✅ counter | | | |
| Token Bucket | ✅ | | | ✅ | | ⚠️ reservoir | ✅ |
| Leaky Bucket | ✅ | | | | | | |
| GCRA | ✅ | | | | | | |
| Concurrency | ✅ | | | | | ✅ | |

**Storage**

| Feature | **throtto** | rate-limiter-flexible | express-rate-limit | @upstash/ratelimit | @nestjs/throttler | bottleneck | limiter |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Memory | ✅ | ✅ | ✅ | | ✅ | ✅ | ✅ |
| Redis | ✅ | ✅ | ⚠️ community | ✅ Upstash only | ⚠️ community | ✅ | |
| PostgreSQL | ✅ | ✅ | | | | | |
| MySQL | ✅ | ✅ | | | | | |
| SQLite | ✅ | ✅ | | | | | |
| MongoDB | | ✅ | ⚠️ community | | ⚠️ community | | |
| Schema gen (SQL/Drizzle/Prisma) | ✅ | | | | | | |

**Framework Adapters**

| Feature | **throtto** | rate-limiter-flexible | express-rate-limit | @upstash/ratelimit | @nestjs/throttler | bottleneck | limiter |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Express | ✅ | ⚠️ separate pkg | ✅ | | ✅ | | |
| Fastify | ✅ | | | | ✅ | | |
| Hono | ✅ | | | | | | |
| Next.js / SvelteKit / Remix | ✅ all three | | | ⚠️ Next.js only | | | |
| Lambda / CF Workers | ✅ | | | ✅ | | | |
| Built-in adapters total | ✅ **18** | ⚠️ 3 separate | ✅ 1 | | ✅ 1 | | |
| Per-endpoint limiting | ✅ | ✅ | ✅ | ✅ | ✅ decorators | | |
| Inline config (no limiter) | ✅ | | | | | | |

**API & DX**

| Feature | **throtto** | rate-limiter-flexible | express-rate-limit | @upstash/ratelimit | @nestjs/throttler | bottleneck | limiter |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Functional composition | ✅ `pipe()` | | | | | ⚠️ `chain()` | |
| String presets | ✅ `'100/min'` | | | | | | |
| RFC 9309 headers | ✅ draft-7 | | ✅ draft-8 | | | | |
| RFC 7807 error bodies | ✅ | | | | | | |
| Key resolvers | ✅ 6 built-in | | ✅ `keyGenerator` | | ✅ `getTracker` | | |
| Decorators | ✅ `@Throttle` | | | | ✅ `@Throttle` | | |

**Advanced Features**

| Feature | **throtto** | rate-limiter-flexible | express-rate-limit | @upstash/ratelimit | @nestjs/throttler | bottleneck | limiter |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Compound (multi-layer) | ✅ | ✅ Union | | | ✅ multi defs | ✅ `chain()` | |
| Tiered limits | ✅ | | | | ⚠️ via decorators | | |
| Dynamic per-key | ✅ | | ✅ fn limit | | | ⚠️ Group | |
| Allowlist / skip | ✅ | ✅ B&W lists | ✅ `skip()` | | ✅ `@Skip` | | |
| Dry-run / shadow | ✅ | | | | | | |
| Override (force) | ✅ | ✅ `block()` | | | | | |
| Penalty box | ✅ | ✅ `penalty()` | | | ✅ blockDuration | | |
| Backpressure | ✅ | | | | | ⚠️ strategies | |
| Graceful shutdown | ✅ | | | | | ✅ `stop()` | |
| Analytics / Prometheus | ✅ | | | ✅ dashboard | | | |
| Fail-open + fallback | ✅ | ✅ insurance | ✅ passOnStoreError | | | | |

**Testing DX**

| Feature | **throtto** | rate-limiter-flexible | express-rate-limit | @upstash/ratelimit | @nestjs/throttler | bottleneck | limiter |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Controllable clock | ✅ | | | | | | |
| Mock store | ✅ | | | | | | |
| One-liner test setup | ✅ | | | | | | |
| Assertion helpers | ✅ | | | | | | |

> Downloads from npm, August 2026. ⚠️ = partial or via community packages. Blank = not available. Corrections welcome - [open an issue](https://github.com/tzezar/throtto/issues).

## Installation

```bash
npm install throtto
# or
pnpm add throtto
# or
yarn add throtto
```

## Quick Start

### One-liner rate limiting

```ts
import { rateLimit } from 'throtto'

const limiter = rateLimit('100/minute')

const result = await limiter.check('user-123')
if (result.allowed) {
  console.log(`Remaining: ${result.remaining}/${result.limit}`)
} else {
  console.log(`Denied. Retry in ${result.retryAfter}ms`)
}
```

### With Express (inline config)

```ts
import { expressRateLimit } from 'throtto/adapters/express'

app.use(expressRateLimit({
  limit: 100,
  window: '1m',
  skipPaths: ['/health', '/metrics'],
}))
```

### With Redis

```ts
import { rateLimit } from 'throtto'
import { redisStore } from 'throtto/stores/redis'

const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: redisStore({ client: myRedisClient }),
})
```

### With `pipe()` composition

```ts
import { rateLimit, pipe, withAllowlist, withDryRun, withOverride } from 'throtto'

// Set up overrides before piping
const overridden = withOverride(rateLimit('100/minute'))
overridden.setOverride('vip-user', { action: 'allow' })
overridden.setOverride('abusive-ip', { action: 'deny' })

// Pipe result is a Limiter — override methods aren't visible on it
const limiter = pipe(
  overridden,
  withAllowlist({ allowlist: ['admin-key', 'internal-service'] }),
  withDryRun({ onShadowDeny: (key, result) => console.warn(`Would deny: ${key}`) }),
)
```

That's it. Pick an algorithm, a store, and a framework adapter - everything else is optional.

---

## Algorithms

| Algorithm | Best For | Burst Tolerance | Memory |
| ----------------------- | ----------------------- | --------------- | ------ |
| **Fixed Window** | Simple rate limiting | Boundary spike possible | O(1) |
| **Sliding Window Counter** | API rate limiting (default) | Low | O(1) |
| **Sliding Window Log** | Precision limiting | None | O(n) |
| **Token Bucket** | Burst-tolerant APIs | High | O(1) |
| **Leaky Bucket** | Smooth output rate | None | O(1) |
| **GCRA** | Cell-based scheduling | Configurable | O(1) |
| **Concurrency** | Parallel execution limits | N/A | O(n) |

```ts
import { rateLimit } from 'throtto'

// Default: sliding-window-counter
const api = rateLimit('100/minute')

// Token bucket - allow bursts
const burst = rateLimit({ limit: 100, window: '1m', algorithm: 'token-bucket' })

// Concurrency - max 5 parallel requests
const concurrent = rateLimit({ limit: 5, window: '1m', algorithm: 'concurrency' })

// All 7: 'fixed-window' | 'sliding-window-counter' | 'sliding-window-log'
//        | 'token-bucket' | 'leaky-bucket' | 'gcra' | 'concurrency'
```

### `rateLimit()` - the simple API

```ts
// String preset
const limiter = rateLimit('100/minute')
const limiter = rateLimit('1000/hour')
const limiter = rateLimit('10/second')

// Object config
const limiter = rateLimit({
  limit: 100,
  window: '1m',          // '30s', '1h', '1d', or milliseconds
  algorithm: 'token-bucket',
  store: redisStore({ client }),
  normalizeKey: 'lowercase',
  failMode: 'open',      // allow on store errors (default: 'closed')
  fallbackStore: memoryStore(),
})
```

### `createLimiter()` - full control

```ts
import { createLimiter, tokenBucket, memoryStore } from 'throtto'

const limiter = createLimiter({
  algorithm: tokenBucket({ capacity: 20, refillRate: 10, refillInterval: 1000 }),
  store: memoryStore(),
  prefix: 'api:',
  normalizeKey: 'lowercase-trim',
  hooks: {
    onAllow: (key, result) => { /* ... */ },
    onDeny: (key, result) => { /* ... */ },
    onError: (key, error) => { /* ... */ },
  },
})
```

### Limiter methods

```ts
// Check and consume a token (returns allowed or denied result)
const result = await limiter.check('user-123')
const result = await limiter.check('user-123', { cost: 5 })

// Consume - throws RateLimitExceededError on deny
const allowed = await limiter.consume('user-123')

// Peek - check current state without consuming
const info = await limiter.peek('user-123')

// Reset - clear rate limit state for a key
await limiter.reset('user-123')

// Shutdown - clean up resources
await limiter.shutdown({ timeout: 5000 })
```

---

## Storage Adapters

| Store | Use Case | Distributed | Persistence |
| -------------- | --------------------------------- | ----------- | ----------- |
| **Memory** | Development, single-process | No | No |
| **Redis** | Production, multi-instance | Yes | Optional |
| **Upstash** | Serverless, edge | Yes | Yes |
| **PostgreSQL** | Already have Postgres | Yes | Yes |
| **MySQL** | Already have MySQL | Yes | Yes |
| **SQLite** | Embedded, single-server | No | Yes |

```ts
import { memoryStore } from 'throtto/stores/memory'
import { redisStore } from 'throtto/stores/redis'
import { upstashStore } from 'throtto/stores/upstash'
import { postgresStore } from 'throtto/stores/postgres'
import { mysqlStore } from 'throtto/stores/mysql'
import { sqliteStore } from 'throtto/stores/sqlite'
```

All stores implement the same `Store` interface - swap them without changing any other code.

### Store features

```ts
// Health check (all stores)
const isHealthy = await store.ping?.()

// List keys (memory + redis)
const keys = await store.keys?.('api:')

// Clean up expired entries (SQL stores)
await store.cleanup?.()

// Shutdown
await store.shutdown?.()
```

### Cache layer

Combine a fast local cache with a distributed store for the best of both worlds:

```ts
import { withCache } from 'throtto'
import { redisStore } from 'throtto/stores/redis'

const store = withCache(redisStore({ client }), {
  maxSize: 1000,
  ttl: 5000, // local cache TTL in ms
})
```

### Database schema

For SQL stores, generate the required schema in your preferred format:

```ts
import { getSchema, getDrizzleSchema, getPrismaSchema } from 'throtto/schemas'

const sql = getSchema('postgres')     // raw SQL
const drizzle = getDrizzleSchema()    // Drizzle ORM
const prisma = getPrismaSchema()      // Prisma schema block
```

Or use the CLI:

```bash
npx throtto schema --store postgres --format sql
npx throtto schema --store mysql --format drizzle
npx throtto schema --store sqlite --format prisma
```

---

## Framework Adapters

Every adapter returns the appropriate middleware type for its framework. Supports `skipPaths`, `skipMethods`, and custom key resolvers.

```ts
// Express / Fastify / Hono - support inline config (no separate limiter needed)
import { expressRateLimit } from 'throtto/adapters/express'
import { fastifyRateLimit } from 'throtto/adapters/fastify'
import { honoRateLimit } from 'throtto/adapters/hono'

// All other adapters
import { nextjsAdapter } from 'throtto/adapters/nextjs'
import { sveltekitAdapter } from 'throtto/adapters/sveltekit'
import { remixAdapter } from 'throtto/adapters/remix'
import { astroAdapter } from 'throtto/adapters/astro'
import { nestjsAdapter } from 'throtto/adapters/nestjs'
import { elysiaAdapter } from 'throtto/adapters/elysia'
import { h3Adapter } from 'throtto/adapters/h3'
import { trpcAdapter } from 'throtto/adapters/trpc'
import { wsAdapter } from 'throtto/adapters/websocket'
import { koaAdapter } from 'throtto/adapters/koa'
import { lambdaAdapter } from 'throtto/adapters/lambda'
import { cfWorkersAdapter } from 'throtto/adapters/cloudflare-workers'
import { bunAdapter } from 'throtto/adapters/bun'
import { denoAdapter } from 'throtto/adapters/deno'
import { httpAdapter } from 'throtto/adapters/http'
```

### Usage examples

```ts
// Express - inline (simplest)
app.use(expressRateLimit({ limit: 100, window: '1m' }))

// Express - with a pre-built limiter
app.use(expressRateLimit({
  limiter,
  skipPaths: ['/health'],
  skipMethods: ['OPTIONS'],
}))

// Hono
app.use('*', honoRateLimit({ limit: 100, window: '1m' }))

// Next.js (middleware.ts)
export default nextjsAdapter({ limiter })

// SvelteKit (hooks.server.ts)
export const handle = sveltekitAdapter({ limiter })

// Lambda
export const handler = lambdaAdapter({ limiter })
```

### Writing a custom adapter

```ts
import type { Limiter } from 'throtto'
import { toHeaders, toErrorBody, shouldSkip } from 'throtto/http'

function myAdapter(config: { limiter: Limiter; skipPaths?: string[] }) {
  return async (req: Request): Promise<Response | null> => {
    const path = new URL(req.url).pathname
    if (shouldSkip(path, req.method, { skipPaths: config.skipPaths })) return null

    const result = await config.limiter.check(req.headers.get('x-api-key') ?? 'anon')

    if (result.allowed) return null // pass through

    return new Response(JSON.stringify(toErrorBody(result)), {
      status: 429,
      headers: toHeaders(result),
    })
  }
}
```

---

## Composition

### `pipe()` - functional composition

Build complex limiters by composing simple wrappers:

```ts
import { rateLimit, pipe, withAllowlist, withDryRun, withOverride, withThresholds } from 'throtto'

const limiter = pipe(
  rateLimit('1000/hour'),
  withAllowlist({ allowlist: ['monitoring-service'] }),
  withThresholds({
    thresholds: [
      { percent: 80, callback: (key) => console.warn(`${key} at 80%`) },
      { percent: 95, callback: (key) => console.error(`${key} near limit`) },
    ],
  }),
  withOverride(),
  withDryRun(),
)
```

### Available wrappers

| Wrapper | Description |
| --------------------- | ------------------------------------------------ |
| `withAllowlist` | Always allow specific keys |
| `withDryRun` | Shadow mode - log but don't enforce |
| `withOverride` | Force allow/deny keys at runtime |
| `withThresholds` | Trigger callbacks at usage % levels |
| `withSoftHardLimit` | Warn before hard cutoff |
| `withConditional` | Skip limiting based on conditions |
| `withBatch` | Check multiple keys in one call |
| `withGracefulShutdown` | Clean shutdown with timeout |
| `withAnalytics` | Collect metrics on every check (import from `'throtto/analytics'`) |

### Advanced limiters

```ts
import {
  createCompoundLimiter,
  createTieredLimiter,
  createDynamicLimiter,
  createHierarchyLimiter,
  createScheduledLimiter,
  createLazyLimiter,
} from 'throtto'

// Compound - multiple simultaneous limits (each layer can use a different algorithm)
const compound = createCompoundLimiter([
  { name: 'burst', limiter: rateLimit({ limit: 10, window: '1s', algorithm: 'token-bucket' }) },
  { name: 'minute', limiter: rateLimit({ limit: 100, window: '1m', algorithm: 'sliding-window-counter' }) },
  { name: 'hour', limiter: rateLimit({ limit: 1000, window: '1h', algorithm: 'fixed-window' }) },
])

// Tiered - free/pro/enterprise (each tier gets its own algorithm)
import { slidingWindowCounter } from 'throtto'

const tiered = createTieredLimiter({
  tiers: [
    { name: 'free', algorithm: slidingWindowCounter({ limit: 100, window: 3_600_000 }) },
    { name: 'pro', algorithm: slidingWindowCounter({ limit: 1000, window: 3_600_000 }) },
    { name: 'enterprise', algorithm: slidingWindowCounter({ limit: 10000, window: 3_600_000 }) },
  ],
  resolveTier: (key) => getUserPlan(key),
})

// Dynamic - per-key algorithm resolved at runtime (LRU-cached)
const dynamic = createDynamicLimiter({
  algorithm: (key) => slidingWindowCounter({ limit: getLimit(key), window: 60_000 }),
  maxCacheSize: 1000,
})

// Hierarchy - org → team → user cascading
const hierarchy = createHierarchyLimiter({
  levels: [
    { name: 'org', algorithm: slidingWindowCounter({ limit: 10000, window: 3_600_000 }) },
    { name: 'team', algorithm: slidingWindowCounter({ limit: 1000, window: 3_600_000 }) },
    { name: 'user', algorithm: slidingWindowCounter({ limit: 100, window: 3_600_000 }) },
  ],
  resolveKeys: (key) => ({ org: getOrg(key), team: getTeam(key), user: key }),
})

// Scheduled - time-based rules (first match wins)
const scheduled = createScheduledLimiter({
  schedule: [
    { name: 'business-hours', when: { hours: [9, 17] }, algorithm: slidingWindowCounter({ limit: 50, window: 60_000 }) },
    { name: 'default', when: 'default', algorithm: slidingWindowCounter({ limit: 100, window: 60_000 }) },
  ],
})

// Lazy - deferred initialization (factory as first arg)
const lazy = createLazyLimiter(
  async () => rateLimit('100/minute'),
  { pendingBehavior: 'allow' },
)
```

### Patterns

```ts
import { throttle, debounce, createPenaltyBox, createQuota, withCostMapping, withBackpressure } from 'throtto'

// Throttle - one call per interval
const throttled = throttle(myFunction, { interval: '1s' })

// Debounce - collapse rapid calls
const debounced = debounce(myFunction, { delay: '500ms' })

// Penalty box - escalating lockout for repeat offenders
const penalties = createPenaltyBox({
  levels: [
    { duration: '1m' },
    { duration: '5m' },
    { duration: '1h' },
  ],
  maxEntries: 10000,
})

// Quota - budget-based limits
const quota = createQuota({ limit: 1000, window: '1d', maxKeys: 50000 })

// Cost mapping - different endpoints cost different amounts
const limiter = pipe(
  rateLimit('100/minute'),
  withCostMapping({ '/search': 5, '/export': 20, default: 1 }),
)

// Backpressure - slow callers down instead of rejecting
const limiter = pipe(
  rateLimit('100/minute'),
  withBackpressure({ strategy: 'delay', maxDelay: '5s' }),
)
```

---

## HTTP Utilities

### Headers (RFC 9309)

```ts
import { toHeaders, toErrorBody } from 'throtto/http'

const result = await limiter.check('user-123')

// draft-7 (RFC 9309) - default
const headers = toHeaders(result)
// { 'RateLimit': 'limit=100, remaining=95, reset=58' }

// draft-6
const draft6 = toHeaders(result, { format: 'draft-6' })

// Legacy (X-RateLimit-*)
const legacy = toHeaders(result, { format: 'legacy' })

// Error body - simple
const body = toErrorBody(result)
// { error: 'Too Many Requests', message: 'Rate limit exceeded. Try again in 58 seconds.', retryAfter: 58 }

// Error body - RFC 7807
const rfc7807 = toErrorBody(result, { format: 'rfc7807' })
// { type: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429', title: 'Too Many Requests', status: 429, ... }
```

### Key resolvers

```ts
import { byIp, byUser, byApiKey, byComposite, byCustom, byPath } from 'throtto/http'

// By IP with proxy trust depth (prevents spoofing)
const key = byIp({ trustDepth: 1 })

// By user header
const key = byUser()

// By API key header
const key = byApiKey()

// By request path
const key = byPath()

// Composite - combine multiple resolvers
const key = byComposite(byUser(), byIp())

// Custom
const key = byCustom((req) => req.headers['x-tenant-id'] ?? 'default')
```

---

## Analytics

```ts
import { withAnalytics } from 'throtto/analytics'
import { toPrometheus, toJSON, toCSV } from 'throtto/analytics'

const limiter = withAnalytics(rateLimit('100/minute'), { enableStream: true })

// Use normally
await limiter.check('user-1')

// Get aggregated metrics
const metrics = limiter.getMetrics()
console.log(metrics.totalRequests, metrics.denyRate, metrics.avgLatencyMs)

// Export as Prometheus
const prometheus = toPrometheus(limiter.getMetrics())

// Export as JSON
const json = toJSON(limiter.getMetrics())

// Export as CSV
const csv = toCSV(limiter.getMetrics())

// Real-time event stream
const stream = limiter.getStream()
if (stream) {
  for await (const event of stream.subscribe()) {
    console.log(event.key, event.allowed, event.latencyMs)
  }
}
```

---

## Decorators

For NestJS and other decorator-based frameworks:

```ts
import { Throttle, SkipThrottle, ThrottleCost, withThrottle } from 'throtto/decorators'

@Throttle({ limit: '100/minute' })
class ApiController {

  @Throttle({ limit: '10/minute', cost: 5 })
  async expensiveOperation() { /* ... */ }

  @SkipThrottle()
  async healthCheck() { /* ... */ }

  @ThrottleCost(10)
  async heavyQuery() { /* ... */ }
}

// Programmatic alternative (no decorators needed)
const throttled = withThrottle(myFunction, {
  limiter,
  key: 'my-operation',
  cost: 2,
})
```

---

## Testing

```ts
import { createTestLimiter } from 'throtto/testing'
import { assertAllowed, assertDenied, exhaust } from 'throtto/testing'

// One-liner test setup - limiter + controllable clock + store
const { limiter, clock, store } = createTestLimiter({ limit: 5, window: '1m' })

// Assert results
const result = await limiter.check('user-1')
assertAllowed(result)

// Exhaust the limit
await exhaust(limiter, 'user-1', 5)
assertDenied(await limiter.check('user-1'))

// Time travel
clock.advance(60_000) // fast-forward 1 minute
assertAllowed(await limiter.check('user-1')) // window reset

// Mock store with failure injection
import { mockStore } from 'throtto/testing'

const store = mockStore({
  failAfter: 3,        // fail after 3 calls
  latencyMs: 50,       // simulate 50ms latency
})
```

---

## Admin & Operations

### Override (force allow/deny)

```ts
import { withOverride } from 'throtto'

const limiter = withOverride(rateLimit('100/minute'))

limiter.setOverride('vip-user', { action: 'allow' })     // always allow
limiter.setOverride('abusive-ip', { action: 'deny' })    // always deny
limiter.removeOverride('vip-user')  // remove override
```

### Export / Import state

```ts
import { exportState, importState } from 'throtto'

// Backup current state
const snapshot = await exportState(store, ['key1', 'key2'])

// Restore on another instance
const result = await importState(store, snapshot)
console.log(`Imported ${result.imported} keys`)
```

### Health checks

```ts
import { createHealthCheck } from 'throtto'

const health = createHealthCheck({ store })
const status = await health.check()
// { status: 'healthy', store: { connected: true, latencyMs: 12 }, uptime: 1234 }
```

### Graceful shutdown

```ts
import { withGracefulShutdown } from 'throtto'

const limiter = withGracefulShutdown(rateLimit('100/minute'), {
  drainTimeout: 5000,
  onNewRequest: 'deny',
})

process.on('SIGTERM', () => limiter.shutdown())
```

---

## TypeScript

Throtto is written in strict TypeScript and exports complete type definitions:

```ts
import type {
  Limiter,
  Store,
  Algorithm,
  RateLimitResult,
  AllowedResult,
  DeniedResult,
  RateLimitInfo,
  Clock,
  LimiterConfig,
  LimiterHooks,
} from 'throtto'

// Type guards
import { isAllowed, isDenied, isLimiter } from 'throtto'

if (isAllowed(result)) {
  result.remaining // typed as AllowedResult
}
```

---

## Key Normalization

Prevent duplicate keys from casing or whitespace:

```ts
const limiter = rateLimit({
  limit: 100,
  window: '1m',
  normalizeKey: 'lowercase',       // 'User-123' → 'user-123'
  // normalizeKey: 'trim',         // ' user-123 ' → 'user-123'
  // normalizeKey: 'lowercase-trim',
  // normalizeKey: (key) => key.replace(/[^a-z0-9]/g, ''),
})
```

## Fail Modes

Control behavior when the store is unavailable:

```ts
const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: redisStore({ client }),
  failMode: 'open',                // allow on store errors (default: 'open')
  fallbackStore: memoryStore(),     // optional: fall back to memory
})
```

---

## Benchmarks

Run with `pnpm run bench`. Results on Intel Core 7 240H, Node.js v22, memory store:

**Algorithms** (single key, sustained throughput)

| Algorithm | ops/sec | avg | p99 |
|---|---:|---:|---:|
| Fixed Window | 2.19M | 381 ns | 714 ns |
| Sliding Window Counter | 2.13M | 393 ns | 634 ns |
| Sliding Window Log | 2.06M | 411 ns | 1.2 μs |
| Token Bucket | 2.16M | 388 ns | 633 ns |
| Leaky Bucket | 2.15M | 390 ns | 602 ns |
| GCRA | 2.16M | 388 ns | 581 ns |
| Concurrency | 155.1K | 6.4 μs | 11.2 μs |

**Composition overhead** (per check, single wrapper vs bare limiter)

| Benchmark | ops/sec | avg | overhead |
|---|---:|---:|---:|
| Bare limiter | 2.10M | 401 ns | - |
| + withAllowlist | 1.78M | 485 ns | +21% |
| + withDryRun | 1.96M | 434 ns | +8% |
| + withOverride | 1.92M | 445 ns | +11% |
| + withThresholds | 1.67M | 522 ns | +30% |
| + withAnalytics | 1.45M | 613 ns | +53% |
| pipe(3 wrappers) | 1.53M | 575 ns | +43% |

**HTTP utilities** (pure computation, no I/O)

| Utility | ops/sec | avg |
|---|---:|---:|
| toHeaders(draft-7) | 5.56M | 105 ns |
| toHeaders(legacy) | 5.06M | 121 ns |
| toErrorBody(simple) | 5.35M | 108 ns |
| toErrorBody(rfc7807) | 5.50M | 106 ns |
| parseDuration("1m30s") | 3.66M | 199 ns |

**Memory store** (raw operations)

| Operation | ops/sec | avg |
|---|---:|---:|
| get (miss) | 4.18M | 165 ns |
| get (hit) | 3.31M | 227 ns |
| set | 3.18M | 241 ns |
| atomic | 2.86M | 273 ns |

<details>
<summary>Run benchmarks yourself</summary>

```bash
pnpm run bench
```

Results vary by CPU, Node.js version, and system load. The benchmark suite is in `benchmarks/run.ts`.

</details>

---

## Bundle Size

| Import | Size (minified + gzipped) |
| ---------------------- | ------------------------- |
| `throtto` (core) | ~3 KB |
| `throtto/stores/redis` | ~1.5 KB |
| `throtto/adapters/*` | ~0.5 KB each |

Zero runtime dependencies in core. Store and framework adapters use optional peer dependencies - install only what you use. Everything is tree-shakeable.

---

## Peer Dependencies

Install only the ones you need:

| Store | Peer Dependency |
|-------|----------------|
| Redis | `ioredis >= 5` |
| Upstash | `@upstash/redis >= 1` |
| PostgreSQL | `pg >= 8` |
| MySQL | `mysql2 >= 3` |
| SQLite | `better-sqlite3 >= 9` |

---

## Contributing

Contributions are welcome! Please open an issue first to discuss significant changes.

```bash
git clone https://github.com/tzezar/throtto.git
cd throtto
pnpm install
pnpm run test        # vitest
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsup
pnpm run lint        # biome
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines on adding algorithms, stores, and adapters.

## Documentation

Full documentation is in the [`docs/`](./docs/) directory:

- [Algorithms](./docs/algorithms.md) - all 7 algorithms with trade-offs and examples
- [Storage Adapters](./docs/stores.md) - setup guides for all 6 stores
- [Framework Adapters](./docs/adapters.md) - all 18 frameworks with copy-paste examples
- [Composition](./docs/composition.md) - `pipe()`, wrappers, advanced limiters
- [Patterns](./docs/patterns.md) - throttle, debounce, penalty box, quota, cost, backpressure
- [HTTP Utilities](./docs/http.md) - headers, error bodies, key resolvers
- [Testing](./docs/testing.md) - controllable clocks, mock stores, assertion helpers
- [Analytics](./docs/analytics.md) - metrics, Prometheus export, event streaming

## Examples

Step-by-step guides in the [`examples/`](./examples/) directory:

| Example | What you'll learn |
|---|---|
| [Basic rate limiting](./examples/basic.md) | `rateLimit()`, check/consume/peek/reset, presets, cost, key normalization |
| [Express integration](./examples/express.md) | Middleware setup, inline config, custom keys, per-route limits |
| [Composition](./examples/composition.md) | `pipe()`, wrappers, override, dry-run, production setup |
| [Storage adapters](./examples/stores.md) | Memory, Redis, Upstash, PostgreSQL, cache layer, schema generation |
| [Testing](./examples/testing.md) | `createTestLimiter`, controllable clock, mock store, Vitest examples |
| [Advanced limiters](./examples/tiered.md) | Compound, tiered, dynamic, hierarchy, scheduled, lazy |
| [Custom adapter](./examples/custom-adapter.md) | Write your own framework adapter (~30 lines) |

## License

[MIT](./LICENSE) © throtto contributors

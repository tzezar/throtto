# Advanced Limiters

Beyond simple rate limiting - compound layers, tiered plans, and more.

## Compound limiter (multi-layer)

Enforce burst + per-minute + per-hour limits simultaneously. Each layer can use a different algorithm - a request must pass ALL layers:

```ts
import { rateLimit, createCompoundLimiter } from '@tzezar/throtto'

const limiter = createCompoundLimiter([
  // Token bucket for burst tolerance
  { name: 'burst', limiter: rateLimit({ limit: 10, window: '1s', algorithm: 'token-bucket' }) },
  // Sliding window for accurate sustained rate
  { name: 'minute', limiter: rateLimit({ limit: 100, window: '1m', algorithm: 'sliding-window-counter' }) },
  // Fixed window for cheap hourly cap
  { name: 'hour', limiter: rateLimit({ limit: 1000, window: '1h', algorithm: 'fixed-window' }) },
])

const result = await limiter.check('user-123')
// Checks in order, short-circuits on first deny
```

## Tiered limiter (free/pro/enterprise)

Different limits per user plan:

```ts
import { createTieredLimiter, slidingWindowCounter } from '@tzezar/throtto'

const limiter = createTieredLimiter({
  tiers: [
    { name: 'free', algorithm: slidingWindowCounter({ limit: 100, window: 3_600_000 }) },
    { name: 'pro', algorithm: slidingWindowCounter({ limit: 1000, window: 3_600_000 }) },
    { name: 'enterprise', algorithm: slidingWindowCounter({ limit: 10_000, window: 3_600_000 }) },
  ],
  resolveTier: (key) => getUserPlan(key),  // return 'free', 'pro', or 'enterprise'
})
```

Each tier maintains its own counters independently.

## Dynamic limiter (per-key config)

Resolve limits at runtime. Useful when different API keys have custom quotas:

```ts
import { createDynamicLimiter, slidingWindowCounter } from '@tzezar/throtto'

const limiter = createDynamicLimiter({
  algorithm: (key) => {
    const limit = getCustomLimit(key)  // from DB, config, etc.
    return slidingWindowCounter({ limit, window: 60_000 })
  },
  maxCacheSize: 1000,  // LRU cache of limiter instances
})
```

## Hierarchy limiter (org → team → user)

Cascading limits - a request must pass all levels:

```ts
import { createHierarchyLimiter, slidingWindowCounter } from '@tzezar/throtto'

const limiter = createHierarchyLimiter({
  levels: [
    { name: 'org', algorithm: slidingWindowCounter({ limit: 10_000, window: 3_600_000 }) },
    { name: 'team', algorithm: slidingWindowCounter({ limit: 1000, window: 3_600_000 }) },
    { name: 'user', algorithm: slidingWindowCounter({ limit: 100, window: 3_600_000 }) },
  ],
  resolveKeys: (key) => ({
    org: getOrg(key),
    team: getTeam(key),
    user: key,
  }),
})
```

## Scheduled limiter (time-based rules)

Different limits by time of day. First matching rule wins:

```ts
import { createScheduledLimiter, slidingWindowCounter } from '@tzezar/throtto'

const limiter = createScheduledLimiter({
  schedule: [
    {
      name: 'business-hours',
      when: { hours: [9, 17] },
      algorithm: slidingWindowCounter({ limit: 50, window: 60_000 }),
    },
    {
      name: 'default',
      when: 'default',
      algorithm: slidingWindowCounter({ limit: 200, window: 60_000 }),
    },
  ],
})
```

## Lazy limiter (deferred init)

Don't connect to Redis until the first request arrives:

```ts
import { createLazyLimiter, rateLimit } from '@tzezar/throtto'
import { redisStore } from '@tzezar/throtto/stores/redis'

const limiter = createLazyLimiter(
  async () => {
    const client = await connectRedis()
    return rateLimit({ limit: 100, window: '1m', store: redisStore({ client }) })
  },
  { pendingBehavior: 'allow' },  // allow requests while initializing
)
```

---

Next: [Custom adapters](./custom-adapter.md) · [Composition deep-dive](../docs/composition.md)

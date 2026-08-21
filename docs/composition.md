# Composition & Advanced Limiters

## pipe() - Functional Composition

Build complex rate limiters by composing simple wrappers:

```ts
import { rateLimit, pipe, withAllowlist, withDryRun, withOverride } from '@tzezar/throtto'

const limiter = pipe(
  rateLimit('100/minute'),           // base limiter
  withAllowlist({ allowlist: ['admin'] }),  // skip for admin
  withDryRun(),                       // shadow mode
  withOverride(),                     // runtime overrides
)
```

Transforms are applied left-to-right. Each wrapper takes a limiter and returns a new limiter.

## Wrappers Reference

For each wrapper, show: what it does, config, example with pipe(), example curried.

### withAllowlist
Config: `{ allowlist?: string[], skip?: (ctx) => boolean | Promise<boolean> }`
Always allows specified keys without consuming tokens.

### withDryRun
Config: `{ onShadowDeny?: (key, result) => void }`
All requests pass, but denials are still logged. Use to test configs before enforcing.

### withOverride
Returns `OverrideLimiter` with: `setOverride(key, { action, reason?, expiresAt? })`, `removeOverride(key)`, `getOverride(key)`, `listOverrides()`, `clearOverrides()`
Force allow/deny specific keys at runtime. Useful for ops: "unblock this VIP NOW".

### withThresholds
Config: `{ thresholds: [{ percent, onThreshold, once? }] }`
Fire callbacks when usage crosses percentage levels (e.g., 80% warning, 95% critical).

### withSoftHardLimit
Config: `{ softLimit, hardLimit, graceRequests?, onSoftLimit? }`
Two-tier limiting: warn between soft and hard, deny beyond hard. Grace period optional.

### withConditional
Config: `{ reservationTtl?: number }`
Adds `reserve(ctx)` → returns `Reservation` with `confirm()` / `cancel()`. Reserve capacity before committing.

### withBatch
Adds `checkMany(items: BatchItem[])` method for multi-key checks.

### withGracefulShutdown
Config: `{ onNewRequest?: 'allow' | 'deny', drainTimeout?: number }`
Tracks in-flight operations, drains during shutdown.

> **Note:** `withGracefulShutdown` has no curried overload and cannot be used in `pipe()`. Call it directly: `withGracefulShutdown(limiter, { ... })`.

### withAnalytics (from throtto/analytics)
Config: `{ collector?, enableStream? }`
Transparent metrics collection on every check. See Analytics docs.

## Advanced Limiters

### createCompoundLimiter
Multi-layer: burst + minute + hour limits simultaneously. Each layer can use a different algorithm and store - they're fully independent limiters.
```ts
const limiter = createCompoundLimiter([
  // Token bucket for burst tolerance
  { name: 'burst', limiter: rateLimit({ limit: 10, window: '1s', algorithm: 'token-bucket' }) },
  // Sliding window for accurate sustained rate
  { name: 'minute', limiter: rateLimit({ limit: 100, window: '1m', algorithm: 'sliding-window-counter' }) },
  // Fixed window for cheap hourly cap
  { name: 'hour', limiter: rateLimit({ limit: 1000, window: '1h', algorithm: 'fixed-window' }) },
])
```
Checks each layer in order. If any layer denies, short-circuits and returns denied immediately. If all pass, returns the most restrictive result (lowest `remaining`).

### createTieredLimiter
Per-tier limits (free/pro/enterprise). Each tier has its own algorithm:
```ts
import { slidingWindowCounter } from '@tzezar/throtto'

const limiter = createTieredLimiter({
  tiers: [
    { name: 'free', algorithm: slidingWindowCounter({ limit: 100, window: 3_600_000 }) },
    { name: 'pro', algorithm: slidingWindowCounter({ limit: 1000, window: 3_600_000 }) },
    { name: 'enterprise', algorithm: slidingWindowCounter({ limit: 10000, window: 3_600_000 }) },
  ],
  resolveTier: (key) => getUserPlan(key),  // returns tier name
})
```

### createDynamicLimiter
Per-key algorithm resolved at runtime with LRU cache:
```ts
const limiter = createDynamicLimiter({
  algorithm: (key) => slidingWindowCounter({ limit: getLimit(key), window: 60_000 }),
  maxCacheSize: 1000,  // max cached limiter instances
})
```

### createHierarchyLimiter
Cascading org → team → user limits. Each level has its own algorithm and keys are resolved via a single function:
```ts
const limiter = createHierarchyLimiter({
  levels: [
    { name: 'org', algorithm: slidingWindowCounter({ limit: 10000, window: 3_600_000 }) },
    { name: 'team', algorithm: slidingWindowCounter({ limit: 1000, window: 3_600_000 }) },
    { name: 'user', algorithm: slidingWindowCounter({ limit: 100, window: 3_600_000 }) },
  ],
  resolveKeys: (key) => ({ org: getOrg(key), team: getTeam(key), user: key }),
})
```

### createScheduledLimiter
Time-based rules. Each rule has a name, when condition, and algorithm. First match wins:
```ts
const limiter = createScheduledLimiter({
  schedule: [
    {
      name: 'business-hours',
      when: { hours: [9, 17] },  // 9am-5pm
      algorithm: slidingWindowCounter({ limit: 50, window: 60_000 }),
    },
    {
      name: 'weekends',
      when: { days: ['sat', 'sun'] },
      algorithm: slidingWindowCounter({ limit: 200, window: 60_000 }),
    },
    {
      name: 'default',
      when: 'default',  // catch-all
      algorithm: slidingWindowCounter({ limit: 100, window: 60_000 }),
    },
  ],
})
```

### createLazyLimiter
Deferred initialization - useful for serverless cold starts. Factory is the first argument:
```ts
const limiter = createLazyLimiter(
  async () => {
    const client = await connectRedis()
    return rateLimit({ limit: 100, window: '1m', store: redisStore({ client }) })
  },
  { pendingBehavior: 'allow' },  // what to do while initializing
)
```

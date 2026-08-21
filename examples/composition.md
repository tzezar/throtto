# Functional Composition

Build complex limiters from simple, composable parts using `pipe()`.

## Basic pipe()

```ts
import { rateLimit, pipe, withAllowlist, withDryRun, withOverride } from '@tzezar/throtto'

const limiter = pipe(
  rateLimit('100/minute'),                              // base limiter
  withAllowlist({ allowlist: ['admin', 'internal'] }),   // always allow these keys
  withDryRun(),                                          // log denials, don't enforce
)
```

Transforms are applied left-to-right. Each takes a limiter in, returns a limiter out.

## Production example

```ts
import {
  rateLimit,
  pipe,
  withAllowlist,
  withOverride,
  withThresholds,
  withSoftHardLimit,
  withGracefulShutdown,
} from '@tzezar/throtto'
import { redisStore } from '@tzezar/throtto/stores/redis'

const limiter = pipe(
  rateLimit({
    limit: 1000,
    window: '1h',
    store: redisStore({ client }),
    failMode: 'open',
  }),
  withAllowlist({ allowlist: ['monitoring-service'] }),
  withThresholds({
    thresholds: [
      { percent: 80, onThreshold: (key) => console.warn(`${key} at 80%`) },
      { percent: 95, onThreshold: (key) => console.error(`${key} near limit`) },
    ],
  }),
  withSoftHardLimit({ softLimit: 900, hardLimit: 1000 }),
  withOverride(),
)

const shutdownLimiter = withGracefulShutdown(limiter, { drainTimeout: 5000 })
```

## Available wrappers

| Wrapper | What it does |
|---|---|
| `withAllowlist({ allowlist })` | Always allow listed keys |
| `withDryRun({ onShadowDeny? })` | Shadow mode - log but don't enforce |
| `withOverride()` | Adds `setOverride()` / `removeOverride()` for ops control |
| `withThresholds({ thresholds })` | Fire callbacks at usage % levels |
| `withSoftHardLimit({ softLimit, hardLimit })` | Warn between soft and hard, deny beyond hard |
| `withConditional({ reservationTtl? })` | Reserve → confirm/cancel pattern |
| `withBatch()` | Adds `checkMany()` for multi-key checks |
| `withGracefulShutdown(limiter, { drainTimeout })` | Drain in-flight ops during shutdown |

## Override (runtime ops control)

```ts
const limiter = withOverride(rateLimit('100/minute'))

// From your admin panel / ops tool:
limiter.setOverride('vip-user', { action: 'allow', reason: 'VIP customer' })
limiter.setOverride('abuser', { action: 'deny', reason: 'abuse detected' })

// Later:
limiter.removeOverride('vip-user')
limiter.listOverrides()   // see all active overrides
limiter.clearOverrides()  // remove all
```

## Dry run (shadow mode)

Test new limits without affecting users:

```ts
const limiter = pipe(
  rateLimit('50/minute'),  // tighter limit you want to test
  withDryRun({
    onShadowDeny: (key, result) => {
      metrics.increment('rate_limit.shadow_deny', { key })
    },
  }),
)

// All requests pass, but you see what WOULD be denied in your metrics.
```

---

Next: [Stores](./stores.md) · [Advanced limiters](../docs/composition.md)

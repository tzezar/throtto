# Express Integration

Three ways to use throtto with Express - from simple to fully customized.

## Way 1: Inline config (simplest)

No separate limiter needed - the adapter creates one internally:

```ts
import express from 'express'
import { expressRateLimit } from '@tzezar/throtto/adapters/express'

const app = express()

app.use(expressRateLimit({
  limit: 100,
  window: '1m',
  skipPaths: ['/health', '/metrics'],
  skipMethods: ['OPTIONS'],
}))
```

This creates a `sliding-window-counter` limiter with a `memoryStore` behind the scenes.

## Way 2: Pre-built limiter

Create the limiter separately for more control or reuse:

```ts
import { rateLimit } from '@tzezar/throtto'
import { expressRateLimit } from '@tzezar/throtto/adapters/express'

const limiter = rateLimit('100/minute')

app.use(expressRateLimit({ limiter }))
```

## Way 3: Composition + custom config

Build a production-grade limiter with `pipe()`, then plug it in:

```ts
import { rateLimit, pipe, withAllowlist, withDryRun } from '@tzezar/throtto'
import { expressRateLimit } from '@tzezar/throtto/adapters/express'

const limiter = pipe(
  rateLimit('100/minute'),
  withAllowlist({ allowlist: ['trusted-service'] }),
  withDryRun({
    onShadowDeny: (key, result) => console.log(`Would deny: ${key}`),
  }),
)

app.use(expressRateLimit({ limiter }))
```

## Custom key extraction

By default, the adapter uses `req.ip`. Override it:

```ts
app.use(expressRateLimit({
  limiter,
  key: (req) => req.headers['x-api-key'] ?? req.ip ?? 'anon',
}))
```

## Custom deny handler

```ts
app.use(expressRateLimit({
  limiter,
  onDeny: (req, res, result) => {
    res.status(429).json({
      error: 'Slow down',
      retryAfter: result.retryAfter,
    })
  },
}))
```

## Per-route limiting

Apply different limits to different routes:

```ts
app.post('/api/login',
  expressRateLimit({ limit: 5, window: '15m' }),
  loginHandler,
)

app.get('/api/search',
  expressRateLimit({ limit: 30, window: '1m' }),
  searchHandler,
)
```

## Header format

Headers are sent automatically. Change the format:

```ts
app.use(expressRateLimit({
  limit: 100,
  window: '1m',
  headerFormat: 'legacy',  // 'draft-7' (default) | 'draft-6' | 'legacy'
}))
```

## Full config reference

| Option | Type | Default | Description |
|---|---|---|---|
| `limiter` | `Limiter` | - | Pre-built limiter |
| `limit` | `number` | - | Inline limit (creates limiter) |
| `window` | `Duration` | - | Inline window (required with `limit`) |
| `algorithm` | `string` | `'sliding-window-counter'` | Algorithm for inline limiter |
| `store` | `Store` | `memoryStore()` | Store for inline limiter |
| `key` | `(req) => string` | `req.ip` | Key resolver |
| `cost` | `number \| (req) => number` | `1` | Cost per request |
| `headers` | `boolean` | `true` | Send rate limit headers |
| `headerFormat` | `HeaderFormat` | `'draft-7'` | Header standard |
| `skipPaths` | `string[]` | - | Paths to skip |
| `skipMethods` | `string[]` | - | HTTP methods to skip |
| `skip` | `(req) => boolean` | - | Custom skip function |
| `onDeny` | `(req, res, result) => void` | - | Custom deny handler |
| `statusCode` | `number` | `429` | Deny status code |
| `message` | `string \| (result) => unknown` | RFC 7807 body | Deny message |

---

Next: [Composition](./composition.md) · [All 18 adapters](../docs/adapters.md)

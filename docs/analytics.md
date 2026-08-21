# Analytics

Throtto has built-in analytics collection with Prometheus, JSON, and CSV export.

> **Why `@tzezar/throtto/analytics` instead of `@tzezar/throtto`?** Analytics includes the ring buffer collector, Prometheus formatter, CSV/JSON exporters, and async streaming infrastructure. Keeping it in a separate entry point ensures this code is fully tree-shaken from bundles that don't use it — your production bundle stays tiny if you only need rate limiting.

## withAnalytics Wrapper

```ts
import { withAnalytics } from '@tzezar/throtto/analytics'
import { rateLimit } from '@tzezar/throtto'

const limiter = withAnalytics(rateLimit('100/minute'), {
  collector: {
    bufferSize: 10_000,     // ring buffer size
    sampleRate: 1.0,         // sample 100% of events (0.1 = 10%)
    maxKeys: 1000,           // max unique keys to track
  },
  enableStream: true,        // enable real-time event stream
})

// Use normally
await limiter.check('user-1')
await limiter.check('user-2')
```

## Metrics

```ts
const metrics = limiter.getMetrics()
// {
//   totalRequests: 150,
//   allowedRequests: 140,
//   deniedRequests: 10,
//   denyRate: 0.066,
//   avgLatencyMs: 0.45,
//   p95LatencyMs: 1.2,
//   p99LatencyMs: 2.1,
//   topKeys: [{ key: 'user-1', count: 50, denyRate: 0.1 }, ...],
//   windowStart: 1724263200000,
//   windowEnd: 1724263260000,
// }
```

## Exporters

### Prometheus

```ts
import { toPrometheus } from '@tzezar/throtto/analytics'

const prometheus = toPrometheus(limiter.getMetrics(), {
  prefix: 'throtto',
  labels: { service: 'api', environment: 'production' },
})
// # HELP throtto_requests_total Total rate limit checks
// # TYPE throtto_requests_total counter
// throtto_requests_total{service="api",environment="production"} 150
// ...
```

Expose in an Express endpoint:
```ts
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain')
  res.send(toPrometheus(limiter.getMetrics()))
})
```

### JSON

```ts
import { toJSON } from '@tzezar/throtto/analytics'
const json = toJSON(limiter.getMetrics())  // pretty-printed JSON string
```

### CSV

```ts
import { toCSV } from '@tzezar/throtto/analytics'
const csv = toCSV(limiter.getMetrics())            // data row only
const csv = toCSV(limiter.getMetrics(), true)       // with header row
```

## Real-Time Event Stream

```ts
const stream = limiter.getStream()
if (stream) {
  for await (const event of stream.subscribe()) {
    console.log(event)
    // { key: 'user-1', allowed: true, cost: 1, timestamp: ..., latencyMs: 0.3, limit: 100, remaining: 95 }
  }
}
```

Multiple subscribers supported. Each gets their own buffer.

## Reset

```ts
limiter.resetAnalytics()  // clear all collected data
```

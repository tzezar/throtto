# Patterns

Beyond rate limiting, throtto provides utility patterns for flow control.

## throttle

Classic function throttle - ensures a function is called at most once per interval.

```ts
import { throttle } from '@tzezar/throtto'

const throttled = throttle(sendAnalytics, {
  interval: 1000,     // max once per second
  leading: true,      // fire on first call (default: true)
  trailing: true,     // fire after interval if calls were queued (default: true)
})

throttled(data)       // fires immediately
throttled(data)       // queued, fires after 1s
throttled.cancel()    // cancel pending
throttled.flush()     // fire pending immediately
```

## debounce

Collapse rapid calls into a single delayed call.

```ts
import { debounce } from '@tzezar/throtto'

const debouncedSearch = debounce(search, {
  wait: 300,          // wait 300ms of silence
  maxWait: 1000,      // fire after max 1s regardless
  leading: false,     // don't fire on first call (default: false)
})

debouncedSearch(query)
debouncedSearch.cancel()
debouncedSearch.flush()
debouncedSearch.pending()  // true if waiting
```

## Penalty Box

Escalating lockout for repeat offenders:

```ts
import { createPenaltyBox } from '@tzezar/throtto'

const penalties = createPenaltyBox({
  levels: [
    { violations: 1, duration: 60_000 },       // 1st offense: 1 min
    { violations: 3, duration: 300_000 },       // 3rd offense: 5 min
    { violations: 5, duration: 3_600_000 },     // 5th offense: 1 hour
  ],
  decayAfter: 86_400_000,  // reset violations after 24h of good behavior
  maxEntries: 10_000,       // max tracked keys (LRU eviction)
})

penalties.penalize('bad-user')
const status = penalties.getStatus('bad-user')
// { penalized: true, level: 1, violations: 1, multiplier: 1, expiresAt: ... }

if (penalties.isPenalized('bad-user')) {
  // reject request
}

penalties.clear('bad-user')    // forgive
penalties.clearAll()           // reset all
```

## Quota

Budget-based limits (daily/monthly API calls):

```ts
import { createQuota } from '@tzezar/throtto'

const quota = createQuota({
  limit: 1000,         // 1000 units per period
  period: '1d',        // daily quota
  maxKeys: 50_000,     // max tracked keys
})

const state = quota.check('user-123')
// { remaining: 998, limit: 1000, resetsAt: ..., used: 2, percentUsed: 0.2 }

const ok = quota.consume('user-123', 5)  // consume 5 units, returns boolean

quota.reset('user-123')
quota.resetAll()
```

## Cost Mapping

Different endpoints consume different amounts:

```ts
import { rateLimit, pipe, withCostMapping } from '@tzezar/throtto'

const limiter = pipe(
  rateLimit('100/minute'),
  withCostMapping({
    resolveCost: (key) => {
      if (key.startsWith('/export')) return 20
      if (key.startsWith('/search')) return 5
      return 1
    },
  }),
)
```

Or use per-request cost:
```ts
await limiter.check('user-123', { cost: 5 })
```

## Backpressure

Slow callers down instead of hard-rejecting:

```ts
import { getBackpressure, withBackpressure } from '@tzezar/throtto'

// Get backpressure signal from a result
const result = await limiter.check('user-123')
const signal = getBackpressure(result, {
  strategy: 'delay',    // 'delay' | 'shed' | 'adaptive'
  maxDelay: 5000,        // max 5 second delay
  baseDelay: 100,        // start at 100ms
})
// { pressure: 0.8, action: 'slow-down', delay: 2000 }

// Or auto-delay a function call
const data = await withBackpressure(limiter, 'user-123', async () => {
  return await fetchData()
}, { strategy: 'adaptive', maxDelay: 3000 })
```

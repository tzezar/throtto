# Testing

Throtto provides first-class testing utilities so you can write deterministic rate limiting tests.

## createTestLimiter - One-Liner Setup

```ts
import { createTestLimiter } from '@tzezar/throtto/testing'

const { limiter, clock, store } = createTestLimiter({
  limit: 5,
  window: '1m',
  algorithm: 'sliding-window-counter', // optional, any of the 7
})

// Everything is wired: controllable clock + memory store
await limiter.check('user-1')  // allowed
clock.advance(60_000)           // fast-forward 1 minute
await limiter.check('user-1')  // allowed (window reset)
```

**Config**: `limit?` (default 10), `window?` (default '1m'), `algorithm?`, `store?`, `clock?`, `prefix?`
**Returns**: `{ limiter, clock, store }`

## testClock - Controllable Time

```ts
import { testClock } from '@tzezar/throtto/testing'

const clock = testClock()           // starts at 1_000_000_000_000 (fixed default)
const clock = testClock(Date.now()) // starts at current time

clock.now()           // current fake time
clock.advance(5000)   // advance 5 seconds
clock.set(1700000000) // set to specific timestamp
clock.tick()          // advance by 1ms
clock.tick(100)       // advance by 100ms
```

Use with any limiter:
```ts
import { rateLimit } from '@tzezar/throtto'

const clock = testClock()
const limiter = rateLimit({ limit: 10, window: '1m', clock })
```

## mockStore - Failure Injection

```ts
import { mockStore } from '@tzezar/throtto/testing'

const store = mockStore()  // works like memoryStore

// With failure injection
const store = mockStore({
  failOn: ['get', 'set'],     // which methods fail
  failAfter: 3,                // fail after 3 successful calls
  latencyMs: 50,               // simulate 50ms latency
})

// Inspect calls
store.getCallCount('get')    // number of get() calls
store.getCallCount('set')
store.calls                  // array of all calls
store.reset()                // clear call history

// Fail next call
store.failNext('get')        // next get() will throw
```

## Assertion Helpers

```ts
import { assertAllowed, assertDenied, exhaust } from '@tzezar/throtto/testing'

const result = await limiter.check('key')
assertAllowed(result)  // throws if denied (with descriptive error)
assertDenied(result)   // throws if allowed

// Exhaust a limiter - fire N checks, return all results
const results = await exhaust(limiter, 'key', 10)
// results: RateLimitResult[] (first N allowed, rest denied)
```

## Example Test (Vitest)

```ts
import { describe, it, expect } from 'vitest'
import { createTestLimiter, assertAllowed, assertDenied, exhaust } from '@tzezar/throtto/testing'

describe('rate limiting', () => {
  it('allows up to limit then denies', async () => {
    const { limiter } = createTestLimiter({ limit: 3, window: '1m' })

    const results = await exhaust(limiter, 'user-1', 5)

    assertAllowed(results[0]!)
    assertAllowed(results[1]!)
    assertAllowed(results[2]!)
    assertDenied(results[3]!)
    assertDenied(results[4]!)
  })

  it('resets after window expires', async () => {
    const { limiter, clock } = createTestLimiter({ limit: 2, window: '1m' })

    await exhaust(limiter, 'user-1', 2)
    assertDenied(await limiter.check('user-1'))

    clock.advance(60_000) // 1 minute later

    assertAllowed(await limiter.check('user-1'))
  })

  it('handles store failures gracefully', async () => {
    const { mockStore } = await import('throtto/testing')
    const { rateLimit } = await import('throtto')

    const store = mockStore({ failAfter: 1 })
    const limiter = rateLimit({ limit: 10, window: '1m', store, failMode: 'open' })

    assertAllowed(await limiter.check('key'))  // works
    assertAllowed(await limiter.check('key'))  // store fails, failMode: 'open' allows
  })
})
```

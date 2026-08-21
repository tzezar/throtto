# Testing Rate Limiters

Throtto ships first-class testing utilities so you can write fast, deterministic tests.

## createTestLimiter - one call

Everything you need in one function call:

```ts
import { createTestLimiter } from '@tzezar/throtto/testing'

const { limiter, clock, store } = createTestLimiter({
  limit: 5,
  window: '1m',
})
```

Returns a limiter wired to a controllable clock and an in-memory store. No real time passes.

## Test: allow up to limit, then deny

```ts
import { createTestLimiter, assertAllowed, assertDenied, exhaust } from '@tzezar/throtto/testing'

const { limiter } = createTestLimiter({ limit: 3, window: '1m' })

const results = await exhaust(limiter, 'user-1', 5)

assertAllowed(results[0]!)  // 1st request: ✅
assertAllowed(results[1]!)  // 2nd: ✅
assertAllowed(results[2]!)  // 3rd: ✅
assertDenied(results[3]!)   // 4th: ❌ over limit
assertDenied(results[4]!)   // 5th: ❌
```

## Test: window reset via clock

```ts
const { limiter, clock } = createTestLimiter({ limit: 2, window: '1m' })

await exhaust(limiter, 'user-1', 2)
assertDenied(await limiter.check('user-1'))

clock.advance(60_000)  // fast-forward 1 minute

assertAllowed(await limiter.check('user-1'))  // window reset ✅
```

## Test: store failures

```ts
import { mockStore } from '@tzezar/throtto/testing'
import { rateLimit } from '@tzezar/throtto'

const store = mockStore({ failAfter: 1 })

const limiter = rateLimit({
  limit: 10,
  window: '1m',
  store,
  failMode: 'open',  // allow on failure
})

assertAllowed(await limiter.check('key'))  // works
assertAllowed(await limiter.check('key'))  // store fails → failMode: 'open' allows
```

## mockStore API

```ts
const store = mockStore({
  failOn: ['get', 'set'],  // which methods throw
  failAfter: 3,             // fail after N successful calls
  latencyMs: 50,            // simulate latency
})

store.getCallCount('get')   // number of get() calls
store.calls                 // all recorded calls
store.failNext('get')       // next get() will throw
store.reset()               // clear call history
```

## testClock API

```ts
import { testClock } from '@tzezar/throtto/testing'

const clock = testClock()              // starts at 1_000_000_000_000 (fixed default)
const clock = testClock(1_000_000)     // starts at specific timestamp

clock.now()          // current fake time
clock.advance(5000)  // advance 5 seconds
clock.set(1700000000)// jump to specific timestamp
clock.tick()         // advance 1ms
clock.tick(100)      // advance 100ms
```

## Full Vitest example

```ts
import { describe, it, expect } from 'vitest'
import { createTestLimiter, assertAllowed, assertDenied, exhaust } from '@tzezar/throtto/testing'

describe('API rate limiting', () => {
  it('enforces per-user limits', async () => {
    const { limiter } = createTestLimiter({ limit: 5, window: '1m' })

    // User A gets their own quota
    await exhaust(limiter, 'user-a', 5)
    assertDenied(await limiter.check('user-a'))

    // User B is unaffected
    assertAllowed(await limiter.check('user-b'))
  })

  it('supports weighted requests', async () => {
    const { limiter } = createTestLimiter({ limit: 10, window: '1m' })

    assertAllowed(await limiter.check('key', { cost: 8 }))  // 8/10 used
    assertAllowed(await limiter.check('key', { cost: 2 }))  // 10/10 used
    assertDenied(await limiter.check('key', { cost: 1 }))   // over limit
  })
})
```

---

Next: [Advanced limiters](./tiered.md) · [Testing deep-dive](../docs/testing.md)

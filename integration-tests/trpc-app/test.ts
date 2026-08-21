import { rateLimit as createLimiter } from '@tzezar/throtto'
import { TrpcRateLimitError, rateLimit } from '@tzezar/throtto/adapters/trpc'

let passed = 0
let failed = 0

function assert(name: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ ${name}`)
    passed++
  } else {
    console.log(`  ❌ ${name}`)
    failed++
  }
}

interface MockCtx {
  userId: string
}

async function run() {
  console.log('\n🧪 tRPC Integration Tests\n')

  const limiter = createLimiter({ limit: 3, window: '1m' })

  const middleware = rateLimit<MockCtx>({
    limiter,
    key: (ctx) => ctx.userId,
  })

  // Test 1: Allowed requests
  console.log('Rate limit (3/minute):')
  for (let i = 0; i < 3; i++) {
    const result = await middleware({
      ctx: { userId: 'user-1' },
      next: async () => ({ data: 'ok' }),
      path: 'getUser',
      type: 'query',
    })
    assert(`Request ${i + 1} allowed`, result !== undefined)
  }

  // Test 2: Denied request throws TrpcRateLimitError
  try {
    await middleware({
      ctx: { userId: 'user-1' },
      next: async () => ({ data: 'ok' }),
      path: 'getUser',
      type: 'query',
    })
    assert('Request 4 denied (throws)', false)
  } catch (err) {
    assert('Request 4 denied (throws TrpcRateLimitError)', err instanceof TrpcRateLimitError)
    if (err instanceof TrpcRateLimitError) {
      assert('Error has code property', typeof err.code === 'string')
      assert('Error has result property', err.result !== undefined)
    }
  }

  // Test 3: Different key works independently
  console.log('\nDifferent keys:')
  const result = await middleware({
    ctx: { userId: 'user-2' },
    next: async () => ({ data: 'different user' }),
    path: 'getUser',
    type: 'query',
  })
  assert('Different user key works', result !== undefined)

  // Test 4: Skip paths
  console.log('\nSkip paths:')
  const skipMiddleware = rateLimit<MockCtx>({
    limiter: createLimiter({ limit: 1, window: '1m' }),
    key: (ctx) => ctx.userId,
    skip: (_ctx, path) => path === 'healthCheck',
  })

  // Exhaust limit
  await skipMiddleware({
    ctx: { userId: 'user-skip' },
    next: async () => 'ok',
    path: 'someRoute',
    type: 'query',
  })

  // Should be skipped even though limit exhausted
  const skipResult = await skipMiddleware({
    ctx: { userId: 'user-skip' },
    next: async () => 'health ok',
    path: 'healthCheck',
    type: 'query',
  })
  assert('Skipped path passes', skipResult !== undefined)

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

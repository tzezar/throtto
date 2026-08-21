import { rateLimit } from '@tzezar/throtto'
import { elysiaRateLimit } from '@tzezar/throtto/adapters/elysia'

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

function createCtx(path: string, method = 'GET'): any {
  return {
    request: new Request(`http://localhost:3015${path}`, { method }),
    set: { status: undefined, headers: {} as Record<string, string> },
    store: {} as Record<string, unknown>,
  }
}

async function run() {
  console.log('\n🧪 Elysia Integration Tests\n')

  const limiter = rateLimit({ limit: 5, window: '1m' })
  const middleware = elysiaRateLimit({
    limiter,
    skipPaths: ['/health'],
    key: () => 'test-key',
  })

  // Test 1: Allowed requests
  console.log('Rate limit (5/minute):')
  for (let i = 0; i < 5; i++) {
    const result = await middleware(createCtx('/'))
    assert(`Request ${i + 1} allowed`, result === undefined)
  }

  // Test 2: Denied request returns a Response
  const denied = await middleware(createCtx('/'))
  assert('Request 6 denied (returns Response)', denied instanceof Response)
  if (denied instanceof Response) {
    assert('Denied status is 429', denied.status === 429)
    const body = await denied.json()
    assert('Denied body has error', body.error !== undefined || body.message !== undefined)
  }

  // Test 3: Skip paths
  console.log('\nSkip paths:')
  const healthResult = await middleware(createCtx('/health'))
  assert('Health endpoint skipped (undefined)', healthResult === undefined)

  // Test 4: Different key
  console.log('\nDifferent keys:')
  const otherMiddleware = elysiaRateLimit({
    limiter: rateLimit({ limit: 2, window: '1m' }),
    key: () => 'other-key',
  })
  const r1 = await otherMiddleware(createCtx('/'))
  assert('Other key request 1 allowed', r1 === undefined)
  const r2 = await otherMiddleware(createCtx('/'))
  assert('Other key request 2 allowed', r2 === undefined)
  const r3 = await otherMiddleware(createCtx('/'))
  assert('Other key request 3 denied', r3 instanceof Response)

  // Test 5: Login strict limit
  console.log('\nLogin endpoint (3/15m):')
  const loginLimiter = rateLimit({ limit: 3, window: '15m' })
  const loginMiddleware = elysiaRateLimit({
    limiter: loginLimiter,
    key: () => 'login-key',
  })
  for (let i = 0; i < 3; i++) {
    const r = await loginMiddleware(createCtx('/api/login', 'POST'))
    assert(`Login ${i + 1} allowed`, r === undefined)
  }
  const loginDenied = await loginMiddleware(createCtx('/api/login', 'POST'))
  assert('Login 4 denied', loginDenied instanceof Response)

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

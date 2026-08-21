import { rateLimit as createLimiter } from '@tzezar/throtto'
import { rateLimit } from '@tzezar/throtto/adapters/lambda'

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

function createEvent(path: string, method = 'GET'): any {
  return {
    headers: { 'x-forwarded-for': '127.0.0.1' },
    requestContext: {
      identity: { sourceIp: '127.0.0.1' },
      http: { sourceIp: '127.0.0.1' },
    },
    httpMethod: method,
    path,
    rawPath: path,
    body: null,
  }
}

async function run() {
  console.log('\n🧪 Lambda Integration Tests\n')

  // Test 1: withLambdaRateLimit wrapper
  console.log('withLambdaRateLimit (3/minute):')
  const limiter = createLimiter({ limit: 3, window: '1m' })

  const handler = rateLimit(
    {
      limiter,
      key: () => 'test-key',
      skipPaths: ['/health'],
    },
    async (event) => ({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'lambda handler', path: event.path }),
    }),
  )

  for (let i = 0; i < 3; i++) {
    const result = await handler(createEvent('/api/data'))
    assert(`Request ${i + 1} allowed (200)`, result.statusCode === 200)
  }

  const denied = await handler(createEvent('/api/data'))
  assert('Request 4 denied (429)', denied.statusCode === 429)

  // Test 2: skipPaths
  console.log('\nSkip paths:')
  const healthResult = await handler(createEvent('/health'))
  assert('Health returns 200 after limit', healthResult.statusCode === 200)

  // Test 3: Headers on denied response
  console.log('\nHeaders:')
  const deniedHeaders = denied.headers
  assert('429 has headers', Object.keys(deniedHeaders).length > 0)

  // Test 4: rateLimit check-only form (standalone)
  console.log('\nrateLimit check-only (standalone):')
  const checkLimiter = createLimiter({ limit: 2, window: '1m' })
  const config = { limiter: checkLimiter, key: () => 'check-key' }
  const check = rateLimit(config)

  const check1 = await check(createEvent('/api/data'))
  assert('Check 1 returns null (allowed)', check1 === null)

  const check2 = await check(createEvent('/api/data'))
  assert('Check 2 returns null (allowed)', check2 === null)

  const check3 = await check(createEvent('/api/data'))
  assert('Check 3 returns result (denied)', check3 !== null && check3.statusCode === 429)

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

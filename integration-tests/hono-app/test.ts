import { start } from './server.js'

const BASE = 'http://localhost:3002'

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.json() }
}

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

async function run() {
  const server = start()
  await new Promise((r) => setTimeout(r, 500))

  console.log('\n🧪 Hono Integration Tests\n')

  // Test 1: Basic requests succeed
  console.log('Global rate limit (10/minute):')
  for (let i = 0; i < 10; i++) {
    const res = await get('/')
    assert(`Request ${i + 1} allowed`, res.status === 200)
  }
  const denied = await get('/')
  assert('Request 11 denied (429)', denied.status === 429)

  // Test 2: Health skipped
  console.log('\nHealth endpoint (skipPaths):')
  const health = await get('/health')
  assert('Health returns 200 after limit', health.status === 200)

  // Test 3: Compound limiter on /api/data
  console.log('\nCompound limiter (/api/data):')
  // Already hit global limit, so /api/data should also be denied by global
  // This tests that per-route middleware stacks correctly
  const apiDenied = await get('/api/data')
  assert('API denied by global limit', apiDenied.status === 429)

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)

  server.close()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

import { start } from './server.js'

const BASE = 'http://localhost:3014'

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.json() }
}

async function post(path: string) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST' })
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

  console.log('\n🧪 NestJS Integration Tests\n')

  // Test 1: Login strict limit (3/15m)
  console.log('Login endpoint (3/15m):')
  for (let i = 0; i < 3; i++) {
    const res = await post('/api/login')
    assert(`Login ${i + 1} allowed`, res.status === 200)
  }
  const loginDenied = await post('/api/login')
  assert('Login 4 denied (429)', loginDenied.status === 429)

  // Test 2: Global rate limit (5/minute)
  console.log('\nGlobal rate limit (5/minute):')
  for (let i = 0; i < 5; i++) {
    const res = await get('/')
    assert(`Request ${i + 1} allowed`, res.status === 200)
  }
  const denied = await get('/')
  assert('Request 6 denied (429)', denied.status === 429)

  // Test 3: Health skip
  console.log('\nHealth endpoint (skipPaths):')
  const health = await get('/health')
  assert('Health returns 200 even after limit', health.status === 200)

  // Test 4: Headers
  console.log('\nHeaders:')
  assert(
    '429 has rate limit headers',
    'ratelimit' in denied.headers || 'ratelimit-limit' in denied.headers,
  )

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)

  server.close()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

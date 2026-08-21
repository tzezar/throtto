import { start } from './server.js'

const BASE = 'http://localhost:3003'

async function get(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, { headers })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), body }
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
  const server = await start()
  await new Promise((r) => setTimeout(r, 300))

  console.log('\n🧪 Fastify Integration Tests\n')

  // Test 1: Global rate limit
  console.log('Global rate limit (10/minute):')
  for (let i = 0; i < 10; i++) {
    const res = await get('/')
    assert(`Request ${i + 1} allowed (status: ${res.status})`, res.status === 200)
  }
  const denied = await get('/')
  assert(`Request 11 denied (status: ${denied.status})`, denied.status === 429)

  // Test 2: Health skipped
  console.log('\nHealth endpoint (skipPaths):')
  const health = await get('/health')
  assert(`Health returns 200 (status: ${health.status})`, health.status === 200)

  // Test 3: Tiered API - pro tier with different key
  console.log('\nTiered API:')
  const proRes = await get('/api/data', { 'x-api-key': 'pro:customer1' })
  assert(`Pro request after global exhausted (status: ${proRes.status})`, proRes.status === 429)

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)

  await server.close()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

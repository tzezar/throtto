import { rateLimit } from '@tzezar/throtto'
import { createWebSocketLimiter } from '@tzezar/throtto/adapters/websocket'

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
  console.log('\n🧪 WebSocket Integration Tests\n')

  const limiter = rateLimit({ limit: 3, window: '1m' })

  const wsLimiter = createWebSocketLimiter({
    limiter,
    key: (info) => info.id ?? info.remoteAddress ?? 'unknown',
  })

  // Test 1: Connection checks
  console.log('Connection rate limit (3/minute):')
  for (let i = 0; i < 3; i++) {
    const result = await wsLimiter.checkConnection({ id: 'ws-1', remoteAddress: '127.0.0.1' })
    assert(`Connection ${i + 1} allowed`, result.allowed === true)
    assert(`Connection ${i + 1} action is allow`, result.action === 'allow')
  }

  const denied = await wsLimiter.checkConnection({ id: 'ws-1', remoteAddress: '127.0.0.1' })
  assert('Connection 4 denied', denied.allowed === false)
  assert('Denied action is close or drop', denied.action === 'close' || denied.action === 'drop')

  // Test 2: Message checks (separate limiter)
  console.log('\nMessage rate limit:')
  const msgLimiter = createWebSocketLimiter({
    limiter: rateLimit({ limit: 2, window: '1m' }),
    key: (info) => `msg:${info.id}`,
  })

  const msg1 = await msgLimiter.checkMessage({ id: 'ws-2', message: 'hello' })
  assert('Message 1 allowed', msg1.allowed === true)
  const msg2 = await msgLimiter.checkMessage({ id: 'ws-2', message: 'world' })
  assert('Message 2 allowed', msg2.allowed === true)
  const msg3 = await msgLimiter.checkMessage({ id: 'ws-2', message: 'spam' })
  assert('Message 3 denied', msg3.allowed === false)

  // Test 3: Different connections are independent
  console.log('\nDifferent connections:')
  const otherConn = await wsLimiter.checkConnection({
    id: 'ws-other',
    remoteAddress: '192.168.1.1',
  })
  assert('Different connection allowed', otherConn.allowed === true)

  // Test 4: Reset
  console.log('\nReset:')
  await wsLimiter.reset({ id: 'ws-1', remoteAddress: '127.0.0.1' })
  const afterReset = await wsLimiter.checkConnection({ id: 'ws-1', remoteAddress: '127.0.0.1' })
  assert('After reset, connection allowed again', afterReset.allowed === true)

  // Test 5: Result has expected properties
  console.log('\nResult properties:')
  assert('Result has result property', afterReset.result !== undefined)
  assert('Result.result has allowed', typeof afterReset.result.allowed === 'boolean')

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

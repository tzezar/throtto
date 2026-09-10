import cluster from 'node:cluster'
import type { Worker } from 'node:cluster'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { clusterStore } from '@tzezar/throtto/stores/cluster'

const PORT = 3018
const WORKERS = 4
const LIMIT = 10

const WORKER_ENTRY = fileURLToPath(new URL('./server.ts', import.meta.url))

let passed = 0
let failed = 0

function assert(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`)
    passed++
  } else {
    console.log(`  ❌ ${name}${detail ? ` - ${detail}` : ''}`)
    failed++
  }
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

interface Response {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: any
}

/**
 * `agent: false` forces a fresh connection per request. With keep-alive the
 * whole suite would be pinned to a single worker by the OS, which would hide
 * exactly what these tests are meant to prove.
 */
function request(path: string, key?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        agent: false,
        headers: key ? { 'x-test-key': key } : {},
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// ─── Cluster lifecycle ───────────────────────────────────────────────────────

const running: Worker[] = []

function startWorkers(store: 'cluster' | 'memory'): Promise<number[]> {
  const ready: number[] = []

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('workers did not come up in 15s')), 15_000)

    for (let i = 0; i < WORKERS; i++) {
      const worker = cluster.fork({
        PORT: String(PORT),
        WORKERS: String(WORKERS),
        LIMIT: String(LIMIT),
        STORE: store,
      })
      running.push(worker)

      worker.on('message', (message: any) => {
        if (message?.type !== 'worker-ready') return
        ready.push(message.id)
        if (ready.length === WORKERS) {
          clearTimeout(timer)
          resolve(ready)
        }
      })
    }
  })
}

async function stopWorkers(): Promise<void> {
  const exits = running.map(
    (worker) =>
      new Promise<void>((resolve) => {
        if (worker.isDead()) return resolve()
        worker.on('exit', () => resolve())
        worker.kill()
      }),
  )
  await Promise.all(exits)
  running.length = 0
  // Give the OS a moment to release the listening socket.
  await new Promise((r) => setTimeout(r, 300))
}

// ─── Suite ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  cluster.setupPrimary({ exec: WORKER_ENTRY })

  // The primary owns the state. It must be listening before any worker forks.
  const store = clusterStore({ maxEntries: 10_000, cleanupInterval: 0 })
  await store.ready()

  console.log('\n🧪 Cluster Mode Integration Tests\n')

  assert('primary detects itself as primary', store.isPrimary === true)
  assert('primary is not degraded', store.degraded === false)

  // ── Phase 1: clusterStore ──────────────────────────────────────────────
  console.log(`\nclusterStore - ${LIMIT}/min shared across ${WORKERS} workers:`)
  const ids = await startWorkers('cluster')
  assert(`all ${WORKERS} workers came up`, ids.length === WORKERS)

  const servedBy = new Set<number>()
  let allowed = 0
  let denied = 0
  let lastDenied: Response | null = null

  for (let i = 0; i < LIMIT + 10; i++) {
    const res = await request('/', 'shared')
    if (res.status === 200) {
      allowed++
      servedBy.add(res.body.worker)
    } else {
      denied++
      lastDenied = res
    }
  }

  assert(
    `exactly ${LIMIT} requests allowed (not ${WORKERS} x ${LIMIT})`,
    allowed === LIMIT,
    `got ${allowed}`,
  )
  assert('remaining requests denied with 429', denied === 10 && lastDenied?.status === 429)
  assert(
    `traffic actually spread across workers (${servedBy.size} of ${WORKERS})`,
    servedBy.size > 1,
    `only worker(s) ${[...servedBy].join(',')} served`,
  )
  assert('429 body carries retryAfter', typeof lastDenied?.body?.retryAfter === 'number')
  assert(
    '429 carries a RateLimit header',
    lastDenied !== null &&
      ('ratelimit' in lastDenied.headers || 'ratelimit-limit' in lastDenied.headers),
  )

  // ── Independent keys ───────────────────────────────────────────────────
  console.log('\nKey isolation:')
  const other = await request('/', 'other-key')
  assert('a different key has its own budget', other.status === 200)

  // ── skipPaths ──────────────────────────────────────────────────────────
  console.log('\nskipPaths:')
  const health = await request('/health', 'shared')
  assert('/health answers 200 even while the key is limited', health.status === 200)

  // ── Concurrent burst ───────────────────────────────────────────────────
  console.log('\nConcurrent burst (all workers at once):')
  const burst = await Promise.all(Array.from({ length: LIMIT + 10 }, () => request('/', 'burst')))
  const burstAllowed = burst.filter((r) => r.status === 200).length
  assert(
    `exactly ${LIMIT} allowed under ${LIMIT + 10} parallel requests`,
    burstAllowed === LIMIT,
    `got ${burstAllowed}`,
  )

  await stopWorkers()

  // ── Phase 2: control group ─────────────────────────────────────────────
  // Proves the assertions above are meaningful: swap in a per-worker store and
  // the same load leaks WORKERS x LIMIT.
  console.log('\nmemoryStore control (each worker keeps its own bucket):')
  await startWorkers('memory')

  let leaked = 0
  for (let i = 0; i < WORKERS * LIMIT + 10; i++) {
    const res = await request('/', 'shared')
    if (res.status === 200) leaked++
  }

  assert(
    `memoryStore leaks more than ${LIMIT} (N x limit problem)`,
    leaked > LIMIT,
    `got ${leaked}`,
  )
  console.log(`     clusterStore: ${allowed} allowed | memoryStore: ${leaked} allowed`)

  await stopWorkers()
  await store.shutdown?.()

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(async (err) => {
  console.error(err)
  await stopWorkers().catch(() => undefined)
  process.exit(1)
})

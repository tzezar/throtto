/**
 * Harness executed in its own process by `tests/stores/cluster-fork.test.ts`.
 *
 * The primary forks real cluster workers, each worker hammers a limiter backed
 * by `clusterStore()`, and the primary prints an aggregated JSON report on
 * stdout. Run directly with:
 *
 *   THROTTO_WORKERS=4 node --import tsx/esm tests/fixtures/cluster-harness.ts
 */
import cluster from 'node:cluster'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { clusterStore } from '../../src/stores/cluster/index.js'

const WORKERS = Number(process.env.THROTTO_WORKERS ?? 4)
const CHECKS = Number(process.env.THROTTO_CHECKS ?? 50)
const LIMIT = Number(process.env.THROTTO_LIMIT ?? 100)
/** How many checks each worker keeps in flight at once. */
const CONCURRENCY = Number(process.env.THROTTO_CONCURRENCY ?? 1)
/** 'shared' = every worker hits one hot key, 'split' = one key per worker. */
const KEY_MODE = process.env.THROTTO_KEY_MODE ?? 'shared'

interface WorkerReport {
  type: 'throtto:report'
  id: number
  allowed: number
  denied: number
  degraded: boolean
  totalMs: number
}

function isReport(value: unknown): value is WorkerReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'throtto:report'
  )
}

if (cluster.isPrimary) {
  const store = clusterStore({ cleanupInterval: 0 })
  await store.ready()

  const reports: WorkerReport[] = []

  await new Promise<void>((resolve, reject) => {
    for (let i = 0; i < WORKERS; i++) {
      const worker = cluster.fork()

      worker.on('message', (message: unknown) => {
        if (!isReport(message)) return
        reports.push(message)
        worker.kill()
        if (reports.length === WORKERS) resolve()
      })

      worker.on('exit', (code) => {
        if (code !== 0 && code !== null && reports.length < WORKERS) {
          reject(new Error(`worker ${worker.id} exited with code ${code}`))
        }
      })
    }
  })

  const allowed = reports.reduce((sum, r) => sum + r.allowed, 0)
  const denied = reports.reduce((sum, r) => sum + r.denied, 0)
  const totalMs = reports.reduce((sum, r) => sum + r.totalMs, 0)
  const checks = allowed + denied

  process.stdout.write(
    `${JSON.stringify({
      isPrimary: store.isPrimary,
      workers: WORKERS,
      limit: LIMIT,
      keyMode: KEY_MODE,
      checks,
      allowed,
      denied,
      degraded: reports.some((r) => r.degraded),
      // Average wall-clock time per check, per worker. With CONCURRENCY=1
      // this is the end-to-end IPC round-trip cost of a single limiter check.
      avgLatencyMs: Number(((totalMs / Math.max(1, checks)) * CONCURRENCY).toFixed(4)),
    })}\n`,
  )

  await store.shutdown?.()
  process.exit(0)
} else {
  const store = clusterStore({
    cleanupInterval: 0,
    // Surface IPC problems instead of silently limiting on local state -
    // the test asserts an exact shared total.
    onUnreachable: 'error',
  })
  await store.ready()

  const limiter = createLimiter({
    algorithm: fixedWindow({ limit: LIMIT, window: '1m' }),
    store,
    failMode: 'closed',
  })

  const id = cluster.worker?.id ?? -1
  const key = KEY_MODE === 'split' ? `worker-${id}` : 'shared-user'

  let allowed = 0
  let denied = 0

  const started = process.hrtime.bigint()
  for (let batch = 0; batch < CHECKS; batch += CONCURRENCY) {
    const size = Math.min(CONCURRENCY, CHECKS - batch)
    const results = await Promise.all(Array.from({ length: size }, () => limiter.check(key)))
    for (const result of results) {
      if (result.allowed) allowed++
      else denied++
    }
  }
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6

  const report: WorkerReport = {
    type: 'throtto:report',
    id,
    allowed,
    denied,
    degraded: store.degraded,
    totalMs,
  }

  process.send?.(report)
}

/**
 * Express server behind a Node.js cluster, sharing one rate limit across
 * workers via `clusterStore()`.
 *
 * Dual purpose:
 * - `pnpm start` runs it directly, so this file is the primary and forks
 *   copies of itself as workers.
 * - `test.ts` uses `cluster.setupPrimary({ exec: server.ts })` and forks it,
 *   so this file only ever runs the worker branch.
 *
 * Env:
 *   PORT      listen port            (default 3018)
 *   WORKERS   number of workers      (default 4)
 *   LIMIT     requests per window    (default 10)
 *   STORE     'cluster' | 'memory'   (default 'cluster')
 *
 * `STORE=memory` is the control case: each worker keeps its own bucket, so
 * WORKERS x LIMIT requests get through instead of LIMIT.
 */
import cluster from 'node:cluster'
import { rateLimit } from '@tzezar/throtto/adapters/express'
import { clusterStore } from '@tzezar/throtto/stores/cluster'
import { memoryStore } from '@tzezar/throtto/stores/memory'
import express from 'express'

export const PORT = Number(process.env.PORT ?? 3018)
export const WORKERS = Number(process.env.WORKERS ?? 4)
export const LIMIT = Number(process.env.LIMIT ?? 10)

const USE_MEMORY = process.env.STORE === 'memory'

// The identical call runs in the primary and in every worker - the role is
// detected from the presence of an IPC channel.
const store = USE_MEMORY
  ? memoryStore({ cleanupInterval: 0 })
  : clusterStore({ maxEntries: 10_000, cleanupInterval: 0 })

if (cluster.isPrimary) {
  // Standalone mode. The primary holds the state and serves no traffic.
  if (!USE_MEMORY) await (store as { ready(): Promise<void> }).ready()

  console.log(
    `primary ${process.pid} | store=${USE_MEMORY ? 'memory' : 'cluster'} | ` +
      `${LIMIT}/min shared across ${WORKERS} workers on :${PORT}`,
  )

  for (let i = 0; i < WORKERS; i++) cluster.fork()

  const shutdown = async (): Promise<void> => {
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill()
    await store.shutdown?.()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
} else {
  const app = express()

  app.use(
    rateLimit({
      limit: LIMIT,
      window: '1m',
      store,
      // `x-test-key` lets the suite drive independent buckets from one client.
      key: (req) => (req.headers['x-test-key'] as string | undefined) ?? req.ip ?? 'unknown',
      skipPaths: ['/health'],
    }),
  )

  app.get('/', (_req, res) => {
    res.json({ ok: true, worker: cluster.worker?.id, pid: process.pid })
  })

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', worker: cluster.worker?.id })
  })

  app.listen(PORT, () => {
    process.send?.({ type: 'worker-ready', id: cluster.worker?.id, pid: process.pid })
  })
}

import { serve } from '@hono/node-server'
import {
  createCompoundLimiter,
  rateLimit as createLimiter,
  pipe,
  withAllowlist,
  withDryRun,
} from '@tzezar/throtto'
import { rateLimit } from '@tzezar/throtto/adapters/hono'
import { Hono } from 'hono'

const app = new Hono()

// Global: 10/minute
app.use('*', rateLimit({ limit: 10, window: '1m', skipPaths: ['/health'] }))

// Compound limiter on /api/* - burst + sustained
const apiLimiter = createCompoundLimiter([
  { name: 'burst', limiter: createLimiter({ limit: 5, window: '10s', algorithm: 'token-bucket' }) },
  {
    name: 'sustained',
    limiter: createLimiter({ limit: 15, window: '1m', algorithm: 'sliding-window-counter' }),
  },
])

app.use('/api/*', rateLimit({ limiter: apiLimiter }))

app.get('/', (c) => c.json({ message: 'throtto hono example' }))
app.get('/health', (c) => c.json({ status: 'ok' }))
app.get('/api/data', (c) => c.json({ data: 'hello', timestamp: Date.now() }))

const PORT = 3002

export function start() {
  return serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Hono app running on http://localhost:${PORT}`)
  })
}

if (process.argv[1]?.includes('server')) {
  start()
}

export { app }

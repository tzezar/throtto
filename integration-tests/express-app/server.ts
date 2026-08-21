import { pipe, rateLimit, withAllowlist } from '@tzezar/throtto'
import { expressRateLimit } from '@tzezar/throtto/adapters/express'
import express from 'express'

const app = express()

// Global rate limit: 10/minute with allowlist
const globalLimiter = pipe(rateLimit('10/minute'), withAllowlist({ allowlist: ['admin'] }))

app.use(
  expressRateLimit({
    limiter: globalLimiter,
    skipPaths: ['/health'],
    key: (req) => req.ip ?? 'unknown',
  }),
)

// Strict: login endpoint
app.post('/api/login', expressRateLimit({ limit: 3, window: '15m' }), (req, res) => {
  res.json({ message: 'login endpoint' })
})

// Loose: data endpoint
app.get('/api/data', expressRateLimit({ limit: 20, window: '1m' }), (req, res) => {
  res.json({ data: 'here is your data', timestamp: Date.now() })
})

// Health check (skipped by global limiter)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'throtto express example' })
})

const PORT = 3001

export function start() {
  return app.listen(PORT, () => {
    console.log(`Express app running on http://localhost:${PORT}`)
  })
}

// Start if run directly
if (process.argv[1]?.includes('server')) {
  start()
}

export { app }

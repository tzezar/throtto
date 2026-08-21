import { createServer } from 'node:http'
import { rateLimit } from '@tzezar/throtto'
import { withRateLimit } from '@tzezar/throtto/adapters/nextjs'

const limiter = rateLimit({ limit: 5, window: '1m' })

// Simulate Next.js route handler pattern
const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({ message: 'next.js route handler' }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// Wrap with rate limiting - skipPaths for /health
const rateLimitedHandler = withRateLimit(
  {
    limiter,
    skipPaths: ['/health'],
    key: () => 'test-key', // fixed key for testing
  },
  handler,
)

// Strict handler for /api/login - separate limiter
const loginLimiter = rateLimit({ limit: 3, window: '15m' })
const loginHandler = withRateLimit(
  {
    limiter: loginLimiter,
    key: () => 'test-key',
  },
  async () =>
    new Response(JSON.stringify({ message: 'login' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
)

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3010')
  const request = new Request(url.toString(), {
    method: req.method,
    headers: Object.entries(req.headers).reduce((h, [k, v]) => {
      if (v) h.set(k, Array.isArray(v) ? v[0] : v)
      return h
    }, new Headers()),
  })

  let response: Response
  if (url.pathname === '/api/login' && req.method === 'POST') {
    response = await loginHandler(request)
  } else {
    response = await rateLimitedHandler(request)
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(await response.text())
})

const PORT = 3010

export function start() {
  server.listen(PORT, () => {
    console.log(`Next.js-style app running on http://localhost:${PORT}`)
  })
  return server
}

if (process.argv[1]?.includes('server')) {
  start()
}

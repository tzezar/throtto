import { createServer } from 'node:http'
import { rateLimit } from '@tzezar/throtto'
import { withRemixRateLimit } from '@tzezar/throtto/adapters/remix'

const limiter = rateLimit({ limit: 5, window: '1m' })

// Simulate a Remix loader with rate limiting
const indexLoader = withRemixRateLimit(
  {
    limiter,
    key: () => 'test-key',
    skipPaths: ['/health'],
  },
  async () =>
    new Response(JSON.stringify({ message: 'remix route' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
)

// Strict login action
const loginLimiter = rateLimit({ limit: 3, window: '15m' })
const loginAction = withRemixRateLimit(
  {
    limiter: loginLimiter,
    key: () => 'test-key',
  },
  async () =>
    new Response(JSON.stringify({ message: 'login' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
)

// Health loader (no rate limiting - but skipPaths should handle it)
const healthLoader = async () =>
  new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  })

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3012')
  const request = new Request(url.toString(), {
    method: req.method,
    headers: Object.entries(req.headers).reduce((h, [k, v]) => {
      if (v) h.set(k, Array.isArray(v) ? v[0] : v)
      return h
    }, new Headers()),
  })

  const args = { request, params: {} }

  let response: Response

  if (url.pathname === '/api/login' && req.method === 'POST') {
    response = await loginAction(args)
  } else if (url.pathname === '/health') {
    // skipPaths on indexLoader should let this through,
    // but let's use the indexLoader directly as a Remix route would
    response = await indexLoader(args)
  } else {
    response = await indexLoader(args)
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(await response.text())
})

const PORT = 3012

export function start() {
  server.listen(PORT, () => {
    console.log(`Remix-style app running on http://localhost:${PORT}`)
  })
  return server
}

if (process.argv[1]?.includes('server')) {
  start()
}

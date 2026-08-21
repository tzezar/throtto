import { createServer } from 'node:http'
import { rateLimit } from '@tzezar/throtto'
import { astroRateLimit } from '@tzezar/throtto/adapters/astro'

const limiter = rateLimit({ limit: 5, window: '1m' })

const middleware = astroRateLimit({
  limiter,
  skipPaths: ['/health'],
  key: () => 'test-key',
})

// Strict login middleware
const loginLimiter = rateLimit({ limit: 3, window: '15m' })
const loginMiddleware = astroRateLimit({
  limiter: loginLimiter,
  key: () => 'test-key',
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3013')
  const request = new Request(url.toString(), {
    method: req.method,
    headers: Object.entries(req.headers).reduce((h, [k, v]) => {
      if (v) h.set(k, Array.isArray(v) ? v[0] : v)
      return h
    }, new Headers()),
  })

  // Build a mock Astro context
  const ctx = {
    request,
    url,
    clientAddress: '127.0.0.1',
    locals: {} as Record<string, unknown>,
  }

  let response: Response

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const next = async () =>
      new Response(JSON.stringify({ message: 'login' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    response = await loginMiddleware(ctx, next)
  } else if (url.pathname === '/health') {
    const next = async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    response = await middleware(ctx, next)
  } else {
    const next = async () =>
      new Response(JSON.stringify({ message: 'astro route' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    response = await middleware(ctx, next)
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(await response.text())
})

const PORT = 3013

export function start() {
  server.listen(PORT, () => {
    console.log(`Astro-style app running on http://localhost:${PORT}`)
  })
  return server
}

if (process.argv[1]?.includes('server')) {
  start()
}

import { createServer } from 'node:http'
import { rateLimit } from '@tzezar/throtto'
import { sveltekitRateLimit } from '@tzezar/throtto/adapters/sveltekit'

const limiter = rateLimit({ limit: 5, window: '1m' })

const handle = sveltekitRateLimit({
  limiter,
  skipPaths: ['/health'],
  key: () => 'test-key',
})

// Strict login limiter
const loginLimiter = rateLimit({ limit: 3, window: '15m' })
const loginHandle = sveltekitRateLimit({
  limiter: loginLimiter,
  key: () => 'test-key',
})

// The "resolve" function simulates what SvelteKit does - returns the actual response
function createResolve(responseBody: Record<string, unknown>) {
  return async () =>
    new Response(JSON.stringify(responseBody), {
      headers: { 'Content-Type': 'application/json' },
    })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3011')
  const request = new Request(url.toString(), {
    method: req.method,
    headers: Object.entries(req.headers).reduce((h, [k, v]) => {
      if (v) h.set(k, Array.isArray(v) ? v[0] : v)
      return h
    }, new Headers()),
  })

  // Build a mock SvelteKit event
  const event = {
    request,
    url,
    getClientAddress: () => '127.0.0.1',
    locals: {} as Record<string, unknown>,
  }

  let response: Response

  if (url.pathname === '/api/login' && req.method === 'POST') {
    response = await loginHandle({
      event,
      resolve: createResolve({ message: 'login' }),
    })
  } else if (url.pathname === '/health') {
    response = await handle({
      event,
      resolve: createResolve({ status: 'ok' }),
    })
  } else {
    response = await handle({
      event,
      resolve: createResolve({ message: 'sveltekit route' }),
    })
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(await response.text())
})

const PORT = 3011

export function start() {
  server.listen(PORT, () => {
    console.log(`SvelteKit-style app running on http://localhost:${PORT}`)
  })
  return server
}

if (process.argv[1]?.includes('server')) {
  start()
}

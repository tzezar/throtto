import { rateLimit as createLimiter } from 'npm:@tzezar/throtto'
import { rateLimit } from 'npm:@tzezar/throtto/adapters/deno'

const limiter = createLimiter({ limit: 5, window: '1m' })

const rateLimitCheck = rateLimit({
  limiter,
  skipPaths: ['/health'],
  key: () => 'test-key',
})

const loginLimiter = createLimiter({ limit: 3, window: '15m' })
const loginCheck = rateLimit({
  limiter: loginLimiter,
  key: () => 'test-key',
})

const PORT = 3017

export function start() {
  const server = Deno.serve({ port: PORT }, async (req, info) => {
    const url = new URL(req.url)

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const denied = await loginCheck(req, info)
      if (denied) return denied
      return Response.json({ message: 'login' })
    }

    const denied = await rateLimitCheck(req, info)
    if (denied) return denied

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    return Response.json({ message: 'deno route' })
  })

  console.log(`Deno app running on http://localhost:${PORT}`)
  return server
}

if (import.meta.main) {
  start()
}

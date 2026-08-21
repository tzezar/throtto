import { rateLimit } from '@tzezar/throtto'
import { bunRateLimit } from '@tzezar/throtto/adapters/bun'

const limiter = rateLimit({ limit: 5, window: '1m' })

const rateLimitCheck = bunRateLimit({
  limiter,
  skipPaths: ['/health'],
  key: () => 'test-key',
})

const loginLimiter = rateLimit({ limit: 3, window: '15m' })
const loginCheck = bunRateLimit({
  limiter: loginLimiter,
  key: () => 'test-key',
})

const PORT = 3016

export function start() {
  const server = Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname === '/api/login' && req.method === 'POST') {
        const denied = await loginCheck(req, server)
        if (denied) return denied
        return Response.json({ message: 'login' })
      }

      const denied = await rateLimitCheck(req, server)
      if (denied) return denied

      if (url.pathname === '/health') {
        return Response.json({ status: 'ok' })
      }

      return Response.json({ message: 'bun route' })
    },
  })

  console.log(`Bun app running on http://localhost:${PORT}`)
  return server
}

if (import.meta.main) {
  start()
}

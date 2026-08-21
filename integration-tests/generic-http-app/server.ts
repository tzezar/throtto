import { createServer } from 'node:http'
import { pipe, rateLimit, withDryRun } from '@tzezar/throtto'
import { createHttpRateLimiter } from '@tzezar/throtto/adapters/http'

// Standard rate limiter
const rl = createHttpRateLimiter({
  limiter: rateLimit('10/minute'),
  skipPaths: ['/health', '/dry-run'],
})

// Dry-run limiter (logs but doesn't enforce)
const dryRunLimiter = pipe(rateLimit('5/minute'), withDryRun())
const dryRl = createHttpRateLimiter({ limiter: dryRunLimiter })

const server = createServer(async (req, res) => {
  // Convert Node request to standard Request
  const url = new URL(req.url ?? '/', 'http://localhost:3006')
  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
  })

  // Check rate limit
  const denied = await rl(request)
  if (denied) {
    res.writeHead(denied.status, Object.fromEntries(denied.headers))
    res.end(await denied.text())
    return
  }

  // Routes
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  } else if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'throtto generic http example' }))
  } else if (url.pathname === '/dry-run') {
    // Dry-run endpoint - always allows, even past limit
    const dryDenied = await dryRl(request)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({ message: 'always allowed (dry-run)', wouldHaveDenied: dryDenied !== null }),
    )
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }
})

const PORT = 3006

export function start() {
  return new Promise<typeof server>((resolve) => {
    server.listen(PORT, () => {
      console.log(`Generic HTTP app running on http://localhost:${PORT}`)
      resolve(server)
    })
  })
}

if (process.argv[1]?.includes('server')) {
  start()
}

export { server }

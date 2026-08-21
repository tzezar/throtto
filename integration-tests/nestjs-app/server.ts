import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { rateLimit } from '@tzezar/throtto'
import { createThrottleGuard } from '@tzezar/throtto/adapters/nestjs'

const limiter = rateLimit({ limit: 5, window: '1m' })

const guard = createThrottleGuard({
  limiter,
  skipPaths: ['/health'],
  key: () => 'test-key',
})

// Login guard with strict limits
const loginLimiter = rateLimit({ limit: 3, window: '15m' })
const loginGuard = createThrottleGuard({
  limiter: loginLimiter,
  key: () => 'test-key',
})

// Create a mock NestJS execution context from Node HTTP req/res
function createContext(req: IncomingMessage, res: ServerResponse) {
  const mockReq = {
    ip: '127.0.0.1',
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    path: req.url ?? '/',
    headers: req.headers as Record<string, string | string[] | undefined>,
  }

  let statusCode = 200
  let responseBody: unknown = null
  const responseHeaders: Record<string, string> = {}

  const mockRes = {
    status(code: number) {
      statusCode = code
      return mockRes
    },
    json(body: unknown) {
      responseBody = body
    },
    setHeader(name: string, value: string) {
      responseHeaders[name] = value
    },
  }

  const context = {
    switchToHttp() {
      return {
        getRequest: () => mockReq,
        getResponse: () => mockRes,
      }
    },
    getHandler: () => () => {},
    getClass: () => class {} as new (...args: unknown[]) => unknown,
  }

  return {
    context,
    getStatus: () => statusCode,
    getBody: () => responseBody,
    getHeaders: () => responseHeaders,
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3014')
  const { context, getStatus, getBody, getHeaders } = createContext(req, res)

  let allowed: boolean
  if (url.pathname === '/api/login' && req.method === 'POST') {
    allowed = await loginGuard(context)
  } else {
    allowed = await guard(context)
  }

  // Apply headers set by the guard
  for (const [k, v] of Object.entries(getHeaders())) {
    res.setHeader(k, v)
  }

  if (!allowed) {
    // Guard denied the request - it already called res.status().json()
    const status = getStatus()
    const body = getBody()
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }

  // Guard allowed - serve the actual response
  res.writeHead(200, { 'Content-Type': 'application/json' })
  if (url.pathname === '/health') {
    res.end(JSON.stringify({ status: 'ok' }))
  } else if (url.pathname === '/api/login') {
    res.end(JSON.stringify({ message: 'login' }))
  } else {
    res.end(JSON.stringify({ message: 'nestjs route' }))
  }
})

const PORT = 3014

export function start() {
  server.listen(PORT, () => {
    console.log(`NestJS-style app running on http://localhost:${PORT}`)
  })
  return server
}

if (process.argv[1]?.includes('server')) {
  start()
}

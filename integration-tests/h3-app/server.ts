import { createServer } from 'node:http'
import { rateLimit as createLimiter } from '@tzezar/throtto'
import { rateLimit } from '@tzezar/throtto/adapters/h3'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

const app = createApp()
const router = createRouter()

// Global rate limit middleware
app.use(
  rateLimit({
    limiter: createLimiter('10/minute'),
    skipPaths: ['/health'],
  }),
)

router.get(
  '/',
  defineEventHandler(() => ({ message: 'throtto h3 example' })),
)
router.get(
  '/health',
  defineEventHandler(() => ({ status: 'ok' })),
)
router.get(
  '/api/data',
  defineEventHandler(() => ({ data: 'hello', timestamp: Date.now() })),
)

app.use(router)

const PORT = 3005

export function start() {
  const server = createServer(toNodeListener(app))
  return new Promise<ReturnType<typeof createServer>>((resolve) => {
    server.listen(PORT, () => {
      console.log(`H3 app running on http://localhost:${PORT}`)
      resolve(server)
    })
  })
}

if (process.argv[1]?.includes('server')) {
  start()
}

export { app }

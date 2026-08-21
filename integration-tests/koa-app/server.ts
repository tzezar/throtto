import { rateLimit as createLimiter } from '@tzezar/throtto'
import { rateLimit } from '@tzezar/throtto/adapters/koa'
import Koa from 'koa'

const app = new Koa()

// Global rate limit
app.use(
  rateLimit({
    limiter: createLimiter('10/minute'),
    skipPaths: ['/health'],
  }),
)

// Routes
app.use(async (ctx) => {
  if (ctx.path === '/health') {
    ctx.body = { status: 'ok' }
  } else if (ctx.path === '/') {
    ctx.body = { message: 'throtto koa example' }
  } else {
    ctx.status = 404
    ctx.body = { error: 'not found' }
  }
})

const PORT = 3004

export function start() {
  return app.listen(PORT, () => {
    console.log(`Koa app running on http://localhost:${PORT}`)
  })
}

if (process.argv[1]?.includes('server')) {
  start()
}

export { app }

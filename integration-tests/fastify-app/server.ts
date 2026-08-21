import { createTieredLimiter, rateLimit, slidingWindowCounter } from '@tzezar/throtto'
import { fastifyRouteRateLimit } from '@tzezar/throtto/adapters/fastify'
import Fastify from 'fastify'

const app = Fastify({ logger: false })

// Global rate limit as onRequest hook
const globalHook = fastifyRouteRateLimit({
  limit: 10,
  window: '1m',
  skipPaths: ['/health'],
})
app.addHook('onRequest', globalHook)

// Tiered limiter for API routes
const tieredLimiter = createTieredLimiter<string>({
  tiers: [
    { name: 'free', algorithm: slidingWindowCounter({ limit: 5, window: 60_000 }) },
    { name: 'pro', algorithm: slidingWindowCounter({ limit: 50, window: 60_000 }) },
  ],
  resolveTier: (key) => (key.startsWith('pro:') ? 'pro' : 'free'),
})

app.get('/', async () => ({ message: 'throtto fastify example' }))
app.get('/health', async () => ({ status: 'ok' }))

app.route({
  method: 'GET',
  url: '/api/data',
  onRequest: fastifyRouteRateLimit({
    limiter: tieredLimiter,
    key: (request) => (request.headers['x-api-key'] as string) ?? 'free:anonymous',
  }),
  handler: async (request) => ({
    data: 'hello',
    tier: (request.headers['x-api-key'] as string)?.startsWith('pro:') ? 'pro' : 'free',
    timestamp: Date.now(),
  }),
})

const PORT = 3003

export async function start() {
  await app.listen({ port: PORT })
  console.log(`Fastify app running on http://localhost:${PORT}`)
  return app
}

if (process.argv[1]?.includes('server')) {
  start()
}

export { app }

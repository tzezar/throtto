# Framework Adapters

Throtto provides 18 framework adapters, each returning the correct middleware type for its framework. Import only what you need - every adapter is a separate entry point, so unused adapters are never bundled.

```ts
import { expressRateLimit } from '@tzezar/throtto/adapters/express'
import { honoRateLimit }    from '@tzezar/throtto/adapters/hono'
import { nextjsAdapter }    from '@tzezar/throtto/adapters/nextjs'
// … etc.
```

---

## Common Features

All adapters share a unified config surface:

| Option          | Type                          | Description                                               |
| --------------- | ----------------------------- | --------------------------------------------------------- |
| `limiter`       | `Limiter`                     | Pre-configured limiter instance                           |
| `skipPaths`     | `string[]`                    | Paths to bypass (e.g., `['/health', '/metrics']`)         |
| `skipMethods`   | `string[]`                    | HTTP methods to bypass (e.g., `['OPTIONS']`)              |
| `skip`          | `(req) => boolean`            | Arbitrary skip predicate                                  |
| `key`           | `(req) => string`             | Custom key resolver (defaults to IP-based)                |
| `cost`          | `number \| (req) => number`   | Token cost per request (default `1`)                      |
| `headers`       | `boolean`                     | Whether to send rate-limit headers (default `true`)       |
| `headerFormat`  | `'draft-7' \| 'draft-6' \| 'legacy'` | Header spec to use (default `'draft-7'`)          |
| `statusCode`    | `number`                      | HTTP status on deny (default `429`)                       |
| `message`       | `string \| object`            | Response body on deny                                     |
| `onDeny`        | `(req, res, result) => void`  | Custom deny handler (signature varies by framework)       |

**Express, Hono, and Fastify** also support **inline config** - pass `{ limit, window }` directly without creating a separate limiter:

```ts
// These two are equivalent:
app.use(expressRateLimit({ limit: 100, window: '1m' }))

const limiter = rateLimit('100/minute')
app.use(expressRateLimit({ limiter }))
```

When both `limiter` and inline options are provided, `limiter` takes precedence.

---

## Express

```ts
import { expressRateLimit } from '@tzezar/throtto/adapters/express'
```

Returns `(req: Request, res: Response, next: NextFunction) => void` - standard Express middleware.

### Inline config (simplest)

```ts
app.use(expressRateLimit({
  limit: 100,
  window: '1m',
  skipPaths: ['/health', '/metrics'],
  skipMethods: ['OPTIONS'],
}))
```

### With a pre-built limiter

```ts
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
app.use(expressRateLimit({ limiter }))
```

### Custom key + deny handler

```ts
app.use(expressRateLimit({
  limiter,
  key: (req) => req.headers['x-api-key'] ?? req.ip ?? 'anon',
  headerFormat: 'draft-7',
  statusCode: 429,
  onDeny: (req, res, result) => {
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: result.retryAfter,
    })
  },
}))
```

### Per-route

```ts
app.post('/api/login', expressRateLimit({ limit: 5, window: '15m' }), loginHandler)
app.get('/api/search', expressRateLimit({ limit: 30, window: '1m' }), searchHandler)
```

**Full config options:** `limiter?`, `limit?`, `window?`, `algorithm?`, `store?`, `key?`, `cost?`, `headers?`, `headerFormat?`, `skipPaths?`, `skipMethods?`, `skip?`, `onDeny?`, `statusCode?`, `message?`

---

## Fastify

```ts
import { fastifyRateLimit } from '@tzezar/throtto/adapters/fastify'
```

Returns a Fastify `onRequest` hook: `(request: FastifyRequest, reply: FastifyReply) => Promise<void>`.

### Inline config

```ts
app.register(async (instance) => {
  instance.addHook('onRequest', fastifyRateLimit({ limit: 100, window: '1m' }))
})
```

### With a limiter

```ts
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
app.addHook('onRequest', fastifyRateLimit({
  limiter,
  skipPaths: ['/health'],
  key: (request) => request.headers['x-api-key'] ?? request.ip,
}))
```

### Per-route

```ts
app.route({
  method: 'POST',
  url: '/api/login',
  onRequest: fastifyRateLimit({ limit: 5, window: '15m' }),
  handler: loginHandler,
})
```

---

## Hono

```ts
import { honoRateLimit } from '@tzezar/throtto/adapters/hono'
```

Returns Hono `MiddlewareHandler` - works with any Hono runtime (Bun, Deno, Cloudflare Workers, Node).

### Inline config

```ts
app.use('*', honoRateLimit({ limit: 100, window: '1m' }))
```

### Scoped to a path

```ts
import { rateLimit } from '@tzezar/throtto'

const apiLimiter = rateLimit('100/minute')
const authLimiter = rateLimit('5/15m')

app.use('/api/*', honoRateLimit({ limiter: apiLimiter }))
app.use('/auth/*', honoRateLimit({ limiter: authLimiter }))
```

### Custom key from Hono context

```ts
app.use('*', honoRateLimit({
  limiter,
  key: (c) => c.req.header('x-api-key') ?? c.req.header('cf-connecting-ip') ?? 'anon',
}))
```

---

## Next.js

```ts
import { nextjsAdapter } from '@tzezar/throtto/adapters/nextjs'
```

Returns a Next.js middleware function compatible with `middleware.ts`.

### Usage

```ts
// middleware.ts
import { nextjsAdapter } from '@tzezar/throtto/adapters/nextjs'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')

export default nextjsAdapter({
  limiter,
  skipPaths: ['/api/health', '/_next'],
})
```

### With matcher

```ts
// middleware.ts
export default nextjsAdapter({ limiter })

export const config = {
  matcher: '/api/:path*',
}
```

### In API routes (App Router)

```ts
// app/api/upload/route.ts
import { nextjsAdapter } from '@tzezar/throtto/adapters/nextjs'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('10/minute')
const rl = nextjsAdapter({ limiter })

export async function POST(request: NextRequest) {
  const denied = await rl(request)
  if (denied) return denied
  // … handle upload
}
```

---

## SvelteKit

```ts
import { sveltekitAdapter } from '@tzezar/throtto/adapters/sveltekit'
```

Returns a SvelteKit `Handle` function for use in `hooks.server.ts`.

### Usage

```ts
// src/hooks.server.ts
import { sveltekitAdapter } from '@tzezar/throtto/adapters/sveltekit'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
export const handle = sveltekitAdapter({ limiter })
```

### With `sequence`

```ts
import { sequence } from '@sveltejs/kit/hooks'
import { sveltekitAdapter } from '@tzezar/throtto/adapters/sveltekit'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')

export const handle = sequence(
  sveltekitAdapter({ limiter, skipPaths: ['/health'] }),
  // … other handles
)
```

### Per-endpoint (in a +server.ts)

```ts
// src/routes/api/upload/+server.ts
import { sveltekitAdapter } from '@tzezar/throtto/adapters/sveltekit'
import { rateLimit } from '@tzezar/throtto'

const uploadLimiter = rateLimit('10/minute')
const rl = sveltekitAdapter({ limiter: uploadLimiter })

export async function POST(event) {
  const denied = await rl(event)
  if (denied) return denied
  // … handle upload
}
```

---

## Remix

```ts
import { remixAdapter } from '@tzezar/throtto/adapters/remix'
```

Works with Remix loaders and actions.

### Global middleware

```ts
// app/middleware.server.ts
import { remixAdapter } from '@tzezar/throtto/adapters/remix'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
export const rateLimitMiddleware = remixAdapter({ limiter })
```

### Per-endpoint (in a loader or action)

```ts
// app/routes/api.upload.tsx
import { remixAdapter } from '@tzezar/throtto/adapters/remix'
import { rateLimit } from '@tzezar/throtto'

const uploadLimiter = remixAdapter({ limiter: rateLimit('10/minute') })

export async function action({ request }: ActionFunctionArgs) {
  const denied = await uploadLimiter(request)
  if (denied) return denied
  // … handle upload
}

export async function loader({ request }: LoaderFunctionArgs) {
  // no rate limiting on GET - only the action is limited
  return json({ status: 'ok' })
}
```

---

## Astro

```ts
import { astroAdapter } from '@tzezar/throtto/adapters/astro'
```

Returns an Astro middleware `onRequest` handler.

### Global middleware

```ts
// src/middleware.ts
import { astroAdapter } from '@tzezar/throtto/adapters/astro'
import { rateLimit } from '@tzezar/throtto'

export const onRequest = astroAdapter({
  limiter: rateLimit('100/minute'),
  skipPaths: ['/health'],
})
```

### Per-endpoint (in an API route)

```ts
// src/pages/api/upload.ts
import { astroAdapter } from '@tzezar/throtto/adapters/astro'
import { rateLimit } from '@tzezar/throtto'
import type { APIRoute } from 'astro'

const rl = astroAdapter({ limiter: rateLimit('10/minute') })

export const POST: APIRoute = async (context) => {
  const denied = await rl(context)
  if (denied) return denied
  return new Response(JSON.stringify({ ok: true }))
}
```

---

## NestJS

```ts
import { nestjsAdapter } from '@tzezar/throtto/adapters/nestjs'
```

Can be used as a NestJS guard or middleware.

### Global middleware

```ts
import { nestjsAdapter } from '@tzezar/throtto/adapters/nestjs'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
app.use(nestjsAdapter({ limiter }))
```

### Per-endpoint (with decorators)

```ts
import { Throttle, SkipThrottle } from '@tzezar/throtto/decorators'

@Throttle({ limit: '100/minute' })
@Controller('users')
export class UsersController {
  @Get()
  findAll() { /* 100/min from class decorator */ }

  @Throttle({ limit: '5/minute' })
  @Post('password-reset')
  resetPassword() { /* tighter limit on this route */ }

  @SkipThrottle()
  @Get('health')
  health() { /* no rate limiting */ }
}
```

### Per-route (without decorators)

```ts
@Controller('api')
export class ApiController {
  @Post('upload')
  async upload(@Req() req: Request, @Res() res: Response, @Next() next) {
    const rl = nestjsAdapter({ limiter: rateLimit('10/minute') })
    rl(req, res, next)
  }
}
```

---

## Elysia (Bun)

```ts
import { elysiaAdapter } from '@tzezar/throtto/adapters/elysia'
```

Returns an Elysia plugin.

### Global

```ts
import { Elysia } from 'elysia'
import { elysiaAdapter } from '@tzezar/throtto/adapters/elysia'
import { rateLimit } from '@tzezar/throtto'

const app = new Elysia()
  .use(elysiaAdapter({ limiter: rateLimit('100/minute') }))
  .listen(3000)
```

### Per-endpoint (scoped plugin)

```ts
const app = new Elysia()
  .group('/api', (app) =>
    app
      .use(elysiaAdapter({ limiter: rateLimit('100/minute') }))
      .get('/users', () => 'users')
  )
  .group('/auth', (app) =>
    app
      .use(elysiaAdapter({ limiter: rateLimit('5/15m') }))
      .post('/login', () => 'login')
  )
  .listen(3000)
```

---

## H3 / Nitro (Nuxt)

```ts
import { h3Adapter } from '@tzezar/throtto/adapters/h3'
```

Returns an H3 event handler, compatible with Nuxt server middleware and standalone Nitro.

### Global (Nuxt server middleware)

```ts
// server/middleware/rate-limit.ts
import { h3Adapter } from '@tzezar/throtto/adapters/h3'
import { rateLimit } from '@tzezar/throtto'

export default h3Adapter({ limiter: rateLimit('100/minute') })
```

### Per-endpoint (Nuxt API route)

```ts
// server/api/upload.post.ts
import { h3Adapter } from '@tzezar/throtto/adapters/h3'
import { rateLimit } from '@tzezar/throtto'

const rl = h3Adapter({ limiter: rateLimit('10/minute') })

export default defineEventHandler(async (event) => {
  const denied = await rl(event)
  if (denied) return denied
  return { ok: true }
})
```

---

## tRPC

```ts
import { trpcAdapter } from '@tzezar/throtto/adapters/trpc'
```

Returns a tRPC middleware for use in procedure chains.

```ts
import { trpcAdapter } from '@tzezar/throtto/adapters/trpc'
import { rateLimit } from '@tzezar/throtto'

const rateLimitMiddleware = trpcAdapter({
  limiter: rateLimit('100/minute'),
  key: (opts) => opts.ctx.user?.id ?? opts.ctx.ip ?? 'anon',
})

const protectedProcedure = t.procedure.use(rateLimitMiddleware)
```

### Per-procedure (different limits)

```ts
const generalLimit = trpcAdapter({ limiter: rateLimit('100/minute') })
const strictLimit = trpcAdapter({ limiter: rateLimit('5/minute') })

const router = t.router({
  listUsers: t.procedure
    .use(generalLimit)
    .query(() => { /* ... */ }),

  resetPassword: t.procedure
    .use(strictLimit)
    .mutation(() => { /* ... */ }),
})
```

---

## WebSocket

```ts
import { wsAdapter } from '@tzezar/throtto/adapters/websocket'
```

Rate-limits WebSocket messages rather than HTTP requests.

```ts
import { wsAdapter } from '@tzezar/throtto/adapters/websocket'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('60/minute')
const rl = wsAdapter({ limiter })

wss.on('connection', (ws, req) => {
  ws.on('message', async (data) => {
    const result = await rl(ws, req)
    if (!result.allowed) return ws.close(1008, 'Rate limited')
    // … handle message
  })
})
```

---

## Koa

```ts
import { koaAdapter } from '@tzezar/throtto/adapters/koa'
```

Returns standard Koa middleware: `(ctx, next) => Promise<void>`.

```ts
import { koaAdapter } from '@tzezar/throtto/adapters/koa'
import { rateLimit } from '@tzezar/throtto'

app.use(koaAdapter({
  limiter: rateLimit('100/minute'),
  skipPaths: ['/health'],
}))
```

### Per-route (with koa-router)

```ts
import Router from '@koa/router'

const router = new Router()

router.post('/api/login',
  koaAdapter({ limiter: rateLimit('5/15m') }),
  loginHandler,
)

router.get('/api/search',
  koaAdapter({ limiter: rateLimit('30/minute') }),
  searchHandler,
)

app.use(router.routes())
```

---

## AWS Lambda

```ts
import { lambdaAdapter } from '@tzezar/throtto/adapters/lambda'
```

Wraps a Lambda handler with rate limiting. Best paired with a Redis or Upstash store for persistence across invocations.

### Single function

```ts
import { lambdaAdapter } from '@tzezar/throtto/adapters/lambda'
import { rateLimit } from '@tzezar/throtto'
import { upstashStore } from '@tzezar/throtto/stores/upstash'

const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: upstashStore({ client }),
})

export const handler = lambdaAdapter({
  limiter,
  key: (event) => event.requestContext?.identity?.sourceIp ?? 'unknown',
})
```

### Per-function (different Lambdas, different limits)

```ts
// lambdas/upload.ts
const uploadLimiter = rateLimit({ limit: 10, window: '1m', store: upstashStore({ client }) })
export const handler = lambdaAdapter({ limiter: uploadLimiter })

// lambdas/search.ts
const searchLimiter = rateLimit({ limit: 100, window: '1m', store: upstashStore({ client }) })
export const handler = lambdaAdapter({ limiter: searchLimiter })
```

---

## Cloudflare Workers

```ts
import { cfWorkersAdapter } from '@tzezar/throtto/adapters/cloudflare-workers'
```

Works with the Workers `fetch` handler. Pairs well with Durable Objects or KV for distributed state.

```ts
import { cfWorkersAdapter } from '@tzezar/throtto/adapters/cloudflare-workers'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
const rl = cfWorkersAdapter({ limiter })

export default {
  async fetch(request: Request, env: Env) {
    const denied = await rl(request, env)
    if (denied) return denied
    // … handle request
  },
}
```

---

## Bun (native HTTP)

```ts
import { bunAdapter } from '@tzezar/throtto/adapters/bun'
```

For Bun's built-in `Bun.serve` - no framework needed.

### Global

```ts
import { bunAdapter } from '@tzezar/throtto/adapters/bun'
import { rateLimit } from '@tzezar/throtto'

const rl = bunAdapter({ limiter: rateLimit('100/minute') })

Bun.serve({
  async fetch(req) {
    const denied = await rl(req)
    if (denied) return denied
    return new Response('OK')
  },
})
```

### Per-endpoint (path-based)

```ts
const apiLimiter = bunAdapter({ limiter: rateLimit('100/minute') })
const uploadLimiter = bunAdapter({ limiter: rateLimit('5/minute') })

Bun.serve({
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname.startsWith('/api/upload')) {
      const denied = await uploadLimiter(req)
      if (denied) return denied
    } else {
      const denied = await apiLimiter(req)
      if (denied) return denied
    }

    return new Response('OK')
  },
})
```

---

## Deno

```ts
import { denoAdapter } from '@tzezar/throtto/adapters/deno'
```

For `Deno.serve` - works with the standard `Request`/`Response` API.

### Global

```ts
import { denoAdapter } from '@tzezar/throtto/adapters/deno'
import { rateLimit } from '@tzezar/throtto'

const rl = denoAdapter({ limiter: rateLimit('100/minute') })

Deno.serve(async (req) => {
  const denied = await rl(req)
  if (denied) return denied
  return new Response('OK')
})
```

### Per-endpoint (path-based)

```ts
const apiLimiter = denoAdapter({ limiter: rateLimit('100/minute') })
const authLimiter = denoAdapter({ limiter: rateLimit('5/15m') })

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (url.pathname.startsWith('/auth')) {
    const denied = await authLimiter(req)
    if (denied) return denied
  } else {
    const denied = await apiLimiter(req)
    if (denied) return denied
  }

  return new Response('OK')
})
```

---

## Generic HTTP

```ts
import { httpAdapter } from '@tzezar/throtto/adapters/http'
```

Works with any framework that uses the standard `Request`/`Response` API - including custom servers, test harnesses, and edge runtimes.

```ts
import { httpAdapter } from '@tzezar/throtto/adapters/http'
import { rateLimit } from '@tzezar/throtto'

const rl = httpAdapter({ limiter: rateLimit('100/minute') })

// Use with any Request/Response handler
async function handler(request: Request): Promise<Response> {
  const denied = await rl(request)
  if (denied) return denied
  return new Response('OK')
}
```

---

## Writing a Custom Adapter

Every adapter follows the same pattern. A minimal custom adapter is ~30 lines:

```ts
import type { Limiter } from '@tzezar/throtto'
import { toHeaders, toErrorBody, shouldSkip } from '@tzezar/throtto/http'

interface AdapterConfig {
  limiter: Limiter
  skipPaths?: string[]
  skipMethods?: string[]
  key?: (req: Request) => string
}

function myAdapter(config: AdapterConfig) {
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url)

    if (shouldSkip(url.pathname, req.method, {
      skipPaths: config.skipPaths,
      skipMethods: config.skipMethods,
    })) {
      return null // bypass - no rate limiting
    }

    const key = config.key
      ? config.key(req)
      : req.headers.get('x-forwarded-for') ?? 'anon'

    const result = await config.limiter.check(key)
    const headers = toHeaders(result)

    if (result.allowed) {
      return null // pass through - merge `headers` into the eventual response
    }

    return new Response(JSON.stringify(toErrorBody(result)), {
      status: 429,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  }
}
```

### Key utilities

| Utility | Purpose |
| ------- | ------- |
| `shouldSkip(path, method, opts)` | Returns `true` if the request matches `skipPaths` or `skipMethods` |
| `toHeaders(result, { format? })` | Builds rate-limit headers (RFC 9309 `draft-7`, `draft-6`, or `legacy`) |
| `toErrorBody(result, { format? })` | Returns a JSON error body (simple object or RFC 7807 problem detail) |

All three are exported from `throtto/http` and are used internally by every built-in adapter.

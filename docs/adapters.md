# Framework Adapters

Throtto provides 18 framework adapters, each returning the correct middleware type for its framework. Import only what you need - every adapter is a separate entry point, so unused adapters are never bundled.

```ts
import { expressRateLimit }       from '@tzezar/throtto/adapters/express'
import { honoRateLimit }          from '@tzezar/throtto/adapters/hono'
import { nextRateLimit }          from '@tzezar/throtto/adapters/nextjs'
import { sveltekitRateLimit }     from '@tzezar/throtto/adapters/sveltekit'
import { withRemixRateLimit }     from '@tzezar/throtto/adapters/remix'
import { astroRateLimit }         from '@tzezar/throtto/adapters/astro'
import { createThrottleGuard }    from '@tzezar/throtto/adapters/nestjs'
import { elysiaRateLimit }        from '@tzezar/throtto/adapters/elysia'
import { h3RateLimit }            from '@tzezar/throtto/adapters/h3'
import { trpcRateLimit }          from '@tzezar/throtto/adapters/trpc'
import { createWebSocketLimiter } from '@tzezar/throtto/adapters/websocket'
import { koaRateLimit }           from '@tzezar/throtto/adapters/koa'
import { withLambdaRateLimit }    from '@tzezar/throtto/adapters/lambda'
import { withCFRateLimit }        from '@tzezar/throtto/adapters/cloudflare-workers'
import { bunRateLimit }           from '@tzezar/throtto/adapters/bun'
import { denoRateLimit }          from '@tzezar/throtto/adapters/deno'
import { createHttpRateLimiter }  from '@tzezar/throtto/adapters/http'
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
| `statusCode`    | `number`                      | HTTP status on deny — **Express, Fastify, NestJS, Koa only** (default `429`) |
| `message`       | `string \| object`            | Response body on deny — **Express only**                  |
| `onDeny`        | varies by adapter             | Custom deny handler (signature varies by framework)       |
| `paths`         | `string[]`                    | Paths to rate-limit — **Next.js, SvelteKit, Astro only**  |
| `excludePaths`  | `string[]`                    | Paths to exclude — **Next.js, SvelteKit, Astro only**     |

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
import { fastifyRateLimit, fastifyRouteRateLimit } from '@tzezar/throtto/adapters/fastify'
```

Two exports:

- **`fastifyRateLimit(config)`** — a Fastify plugin: `(fastify) => void`. Registers an `onRequest` hook globally (skips encapsulation). Use with `app.register()`.
- **`fastifyRouteRateLimit(config)`** — a Fastify hook: `(request: FastifyRequest, reply: FastifyReply) => Promise<void>`. Use with `app.addHook('onRequest', ...)` or per-route `onRequest`.

### Global with plugin (simplest)

```ts
import { fastifyRateLimit } from '@tzezar/throtto/adapters/fastify'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
await app.register(fastifyRateLimit({
  limiter,
  skipPaths: ['/health'],
  key: (request) => request.headers['x-api-key'] ?? request.ip,
}))
```

### Global with hook

```ts
import { fastifyRouteRateLimit } from '@tzezar/throtto/adapters/fastify'

app.addHook('onRequest', fastifyRouteRateLimit({ limit: 100, window: '1m' }))
```

### Per-route

```ts
app.route({
  method: 'POST',
  url: '/api/login',
  onRequest: fastifyRouteRateLimit({ limit: 5, window: '15m' }),
  handler: loginHandler,
})
```

---

## Hono

```ts
import { honoRateLimit } from '@tzezar/throtto/adapters/hono'
```

Returns `(c, next) => Promise<Response | undefined>` — works with any Hono runtime (Bun, Deno, Cloudflare Workers, Node).

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
import { nextRateLimit, withRateLimit } from '@tzezar/throtto/adapters/nextjs'
```

Two exports:

- **`nextRateLimit(config)`** — returns `(req: NextRequest) => Promise<Response | null>`. Designed for `middleware.ts`. Returns `null` when the request is allowed, or a `Response` when denied.
- **`withRateLimit(config, handler)`** — wraps a route handler: `(req: Request) => Promise<Response>`. Designed for App Router API routes.

### Middleware usage

```ts
// middleware.ts
import { nextRateLimit } from '@tzezar/throtto/adapters/nextjs'
import { rateLimit } from '@tzezar/throtto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const limiter = rateLimit('100/minute')
const rateLimitCheck = nextRateLimit({
  limiter,
  excludePaths: ['/api/health', '/_next'],
})

export async function middleware(request: NextRequest) {
  const denied = await rateLimitCheck(request)
  if (denied) return denied
  return NextResponse.next()
}
```

### With matcher

```ts
// middleware.ts
import { nextRateLimit } from '@tzezar/throtto/adapters/nextjs'

const rateLimitCheck = nextRateLimit({ limiter })

export async function middleware(request: NextRequest) {
  const denied = await rateLimitCheck(request)
  if (denied) return denied
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
```

### In API routes (App Router)

```ts
// app/api/upload/route.ts
import { withRateLimit } from '@tzezar/throtto/adapters/nextjs'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('10/minute')

export const POST = withRateLimit({ limiter }, async (req: Request) => {
  // … handle upload
  return new Response(JSON.stringify({ ok: true }))
})
```

---

## SvelteKit

```ts
import { sveltekitRateLimit } from '@tzezar/throtto/adapters/sveltekit'
```

Returns a SvelteKit `Handle` function: `({ event, resolve }) => Promise<Response>`. Stores the rate-limit result in `event.locals.rateLimitResult`.

### Usage

```ts
// src/hooks.server.ts
import { sveltekitRateLimit } from '@tzezar/throtto/adapters/sveltekit'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
export const handle = sveltekitRateLimit({ limiter })
```

### With `sequence`

```ts
import { sequence } from '@sveltejs/kit/hooks'
import { sveltekitRateLimit } from '@tzezar/throtto/adapters/sveltekit'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')

export const handle = sequence(
  sveltekitRateLimit({ limiter, excludePaths: ['/health'] }),
  // … other handles
)
```

### Accessing the result

```ts
// In a +server.ts or +page.server.ts
export async function load({ locals }) {
  // Available after the handle hook runs
  const rateLimitResult = locals.rateLimitResult
  // …
}
```

---

## Remix

```ts
import { withRemixRateLimit } from '@tzezar/throtto/adapters/remix'
```

Wraps a Remix handler (loader or action). The handler receives `RemixArgs { request, params, context? }`.

Signature: `withRemixRateLimit(config, handler)` → `(args: RemixArgs) => Promise<Response>`

### Wrapping an action

```ts
// app/routes/api.upload.tsx
import { withRemixRateLimit } from '@tzezar/throtto/adapters/remix'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('10/minute')

export const action = withRemixRateLimit({ limiter }, async ({ request, params }) => {
  // … handle upload
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

### Per-route with different limits

```ts
import { withRemixRateLimit } from '@tzezar/throtto/adapters/remix'
import { rateLimit } from '@tzezar/throtto'

export const action = withRemixRateLimit(
  { limiter: rateLimit('5/15m') },
  async ({ request }) => {
    // … handle login
    return new Response(JSON.stringify({ ok: true }))
  },
)

export async function loader({ request }: LoaderFunctionArgs) {
  // no rate limiting on GET - only the action is limited
  return json({ status: 'ok' })
}
```

---

## Astro

```ts
import { astroRateLimit } from '@tzezar/throtto/adapters/astro'
```

Returns an Astro middleware: `(ctx, next) => Promise<Response>`. Stores the rate-limit result in `ctx.locals.rateLimitResult`.

### Global middleware

```ts
// src/middleware.ts
import { astroRateLimit } from '@tzezar/throtto/adapters/astro'
import { rateLimit } from '@tzezar/throtto'

export const onRequest = astroRateLimit({
  limiter: rateLimit('100/minute'),
  excludePaths: ['/health'],
})
```

### Per-endpoint (in an API route)

```ts
// src/pages/api/upload.ts
import { astroRateLimit } from '@tzezar/throtto/adapters/astro'
import { rateLimit } from '@tzezar/throtto'
import type { APIRoute } from 'astro'

const rl = astroRateLimit({ limiter: rateLimit('10/minute') })

export const POST: APIRoute = async (context, next) => {
  const denied = await rl(context, next)
  if (denied) return denied
  return new Response(JSON.stringify({ ok: true }))
}
```

---

## NestJS

```ts
import { createThrottleGuard, getThrottleMetadataKey, getSkipThrottleMetadataKey } from '@tzezar/throtto/adapters/nestjs'
```

Returns a guard function: `(context: NestExecutionContext) => Promise<boolean>`. Wrap it in an `@Injectable()` class implementing `CanActivate`.

### As a global guard

```ts
import { createThrottleGuard } from '@tzezar/throtto/adapters/nestjs'
import { rateLimit } from '@tzezar/throtto'
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'

const check = createThrottleGuard({ limiter: rateLimit('100/minute') })

@Injectable()
export class ThrottleGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    return check(context)
  }
}

// main.ts
app.useGlobalGuards(new ThrottleGuard())
```

### Per-endpoint (with decorators)

Use `getThrottleMetadataKey()` and `getSkipThrottleMetadataKey()` with NestJS's `SetMetadata` to create custom decorators:

```ts
import { SetMetadata } from '@nestjs/common'
import { getThrottleMetadataKey, getSkipThrottleMetadataKey } from '@tzezar/throtto/adapters/nestjs'

export const Throttle = (config: { limit: string }) =>
  SetMetadata(getThrottleMetadataKey(), config)

export const SkipThrottle = () =>
  SetMetadata(getSkipThrottleMetadataKey(), true)
```

```ts
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

---

## Elysia (Bun)

```ts
import { elysiaRateLimit } from '@tzezar/throtto/adapters/elysia'
```

Returns a handler function: `(ctx: ElysiaContext) => Promise<Response | undefined>`. Use with `app.onBeforeHandle()`. Returns `undefined` when the request is allowed, or a `Response` when denied.

### Global

```ts
import { Elysia } from 'elysia'
import { elysiaRateLimit } from '@tzezar/throtto/adapters/elysia'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')

const app = new Elysia()
  .onBeforeHandle(elysiaRateLimit({ limiter }))
  .listen(3000)
```

### Per-endpoint (scoped)

```ts
const apiHandler = elysiaRateLimit({ limiter: rateLimit('100/minute') })
const authHandler = elysiaRateLimit({ limiter: rateLimit('5/15m') })

const app = new Elysia()
  .group('/api', (app) =>
    app
      .onBeforeHandle(apiHandler)
      .get('/users', () => 'users')
  )
  .group('/auth', (app) =>
    app
      .onBeforeHandle(authHandler)
      .post('/login', () => 'login')
  )
  .listen(3000)
```

---

## H3 / Nitro (Nuxt)

```ts
import { h3RateLimit } from '@tzezar/throtto/adapters/h3'
```

Returns `(event: H3Event) => Promise<undefined | string>`. Returns `undefined` when the request is allowed, or a string response when denied. Compatible with Nuxt server middleware and standalone Nitro.

### Global (Nuxt server middleware)

```ts
// server/middleware/rate-limit.ts
import { h3RateLimit } from '@tzezar/throtto/adapters/h3'
import { rateLimit } from '@tzezar/throtto'

const check = h3RateLimit({ limiter: rateLimit('100/minute') })

export default defineEventHandler(async (event) => {
  const denied = await check(event)
  if (denied) return denied
})
```

### Per-endpoint (Nuxt API route)

```ts
// server/api/upload.post.ts
import { h3RateLimit } from '@tzezar/throtto/adapters/h3'
import { rateLimit } from '@tzezar/throtto'

const check = h3RateLimit({ limiter: rateLimit('10/minute') })

export default defineEventHandler(async (event) => {
  const denied = await check(event)
  if (denied) return denied
  return { ok: true }
})
```

---

## tRPC

```ts
import { trpcRateLimit, TrpcRateLimitError } from '@tzezar/throtto/adapters/trpc'
```

Returns a tRPC middleware: `(opts) => Promise<unknown>`. **`key` is required** — there is no default key resolver for tRPC since there's no standard way to extract an IP from the context.

Throws `TrpcRateLimitError` on deny (not a `Response`).

```ts
import { trpcRateLimit } from '@tzezar/throtto/adapters/trpc'
import { rateLimit } from '@tzezar/throtto'

const rateLimitMiddleware = trpcRateLimit({
  limiter: rateLimit('100/minute'),
  key: (ctx) => ctx.userId ?? ctx.ip ?? 'anon',
})

const protectedProcedure = t.procedure.use(rateLimitMiddleware)
```

### Per-procedure (different limits)

```ts
const generalLimit = trpcRateLimit({
  limiter: rateLimit('100/minute'),
  key: (ctx) => ctx.userId ?? 'anon',
})
const strictLimit = trpcRateLimit({
  limiter: rateLimit('5/minute'),
  key: (ctx) => ctx.userId ?? 'anon',
})

const router = t.router({
  listUsers: t.procedure
    .use(generalLimit)
    .query(() => { /* ... */ }),

  resetPassword: t.procedure
    .use(strictLimit)
    .mutation(() => { /* ... */ }),
})
```

### Handling errors

```ts
import { TrpcRateLimitError } from '@tzezar/throtto/adapters/trpc'

// In your error handler or client
if (error instanceof TrpcRateLimitError) {
  // error.retryAfter — seconds until the limit resets
}
```

---

## WebSocket

```ts
import { createWebSocketLimiter } from '@tzezar/throtto/adapters/websocket'
```

Rate-limits WebSocket connections and messages. **`key` is required.** Returns an object with `checkConnection()`, `checkMessage()`, and `reset()` methods — completely different from the HTTP adapters.

```ts
import { createWebSocketLimiter } from '@tzezar/throtto/adapters/websocket'
import { rateLimit } from '@tzezar/throtto'

const wsLimiter = createWebSocketLimiter({
  limiter: rateLimit('60/minute'),
  key: (ws, req) => req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'anon',
})

wss.on('connection', (ws, req) => {
  const connectionResult = wsLimiter.checkConnection(ws, req)
  if (!connectionResult.allowed) return ws.close(1008, 'Rate limited')

  ws.on('message', async (data) => {
    const result = await wsLimiter.checkMessage(ws, req)
    if (!result.allowed) return ws.close(1008, 'Rate limited')
    // … handle message
  })
})

// Reset a specific key's state
wsLimiter.reset('some-key')
```

---

## Koa

```ts
import { koaRateLimit } from '@tzezar/throtto/adapters/koa'
```

Returns standard Koa middleware: `(ctx, next) => Promise<void>`.

```ts
import { koaRateLimit } from '@tzezar/throtto/adapters/koa'
import { rateLimit } from '@tzezar/throtto'

app.use(koaRateLimit({
  limiter: rateLimit('100/minute'),
  skipPaths: ['/health'],
}))
```

### Per-route (with koa-router)

```ts
import Router from '@koa/router'

const router = new Router()

router.post('/api/login',
  koaRateLimit({ limiter: rateLimit('5/15m') }),
  loginHandler,
)

router.get('/api/search',
  koaRateLimit({ limiter: rateLimit('30/minute') }),
  searchHandler,
)

app.use(router.routes())
```

---

## AWS Lambda

```ts
import { withLambdaRateLimit, lambdaRateLimitCheck } from '@tzezar/throtto/adapters/lambda'
```

Two exports:

- **`withLambdaRateLimit(config, handler)`** — wraps a Lambda handler: `(event) => Promise<APIGatewayResult>`. Best paired with a Redis or Upstash store for persistence across invocations.
- **`lambdaRateLimitCheck(config, event)`** — standalone check: `Promise<APIGatewayResult | null>`. Returns `null` when allowed, or an `APIGatewayResult` when denied.

### Wrapping a handler

```ts
import { withLambdaRateLimit } from '@tzezar/throtto/adapters/lambda'
import { rateLimit } from '@tzezar/throtto'
import { upstashStore } from '@tzezar/throtto/stores/upstash'

const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: upstashStore({ client }),
})

export const handler = withLambdaRateLimit(
  {
    limiter,
    key: (event) => event.requestContext?.identity?.sourceIp ?? 'unknown',
  },
  async (event) => {
    // … handle request
    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  },
)
```

### Standalone check

```ts
import { lambdaRateLimitCheck } from '@tzezar/throtto/adapters/lambda'

export const handler = async (event) => {
  const denied = await lambdaRateLimitCheck({ limiter }, event)
  if (denied) return denied
  // … handle request
  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
```

### Per-function (different Lambdas, different limits)

```ts
// lambdas/upload.ts
const uploadLimiter = rateLimit({ limit: 10, window: '1m', store: upstashStore({ client }) })
export const handler = withLambdaRateLimit({ limiter: uploadLimiter }, async (event) => {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
})

// lambdas/search.ts
const searchLimiter = rateLimit({ limit: 100, window: '1m', store: upstashStore({ client }) })
export const handler = withLambdaRateLimit({ limiter: searchLimiter }, async (event) => {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
})
```

---

## Cloudflare Workers

```ts
import { withCFRateLimit } from '@tzezar/throtto/adapters/cloudflare-workers'
```

Wraps the Workers `fetch` handler: `(request, env, ctx) => Promise<Response>`. Pairs well with Durable Objects or KV for distributed state.

```ts
import { withCFRateLimit } from '@tzezar/throtto/adapters/cloudflare-workers'
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')

export default {
  fetch: withCFRateLimit({ limiter }, async (request, env, ctx) => {
    // … handle request
    return new Response('OK')
  }),
}
```

---

## Bun (native HTTP)

```ts
import { bunRateLimit, withBunRateLimit } from '@tzezar/throtto/adapters/bun'
```

Two exports for Bun's built-in `Bun.serve` - no framework needed. Both receive `(req, server)` — the `server` parameter provides `requestIP()`.

- **`bunRateLimit(config)`** — returns `(req, server) => Promise<Response | null>`. Returns `null` when allowed.
- **`withBunRateLimit(config, handler)`** — wraps a handler: `(req, server) => Promise<Response>`.

### With `bunRateLimit`

```ts
import { bunRateLimit } from '@tzezar/throtto/adapters/bun'
import { rateLimit } from '@tzezar/throtto'

const rl = bunRateLimit({ limiter: rateLimit('100/minute') })

Bun.serve({
  async fetch(req, server) {
    const denied = await rl(req, server)
    if (denied) return denied
    return new Response('OK')
  },
})
```

### With `withBunRateLimit`

```ts
import { withBunRateLimit } from '@tzezar/throtto/adapters/bun'
import { rateLimit } from '@tzezar/throtto'

Bun.serve({
  fetch: withBunRateLimit({ limiter: rateLimit('100/minute') }, async (req, server) => {
    return new Response('OK')
  }),
})
```

### Per-endpoint (path-based)

```ts
const apiLimiter = bunRateLimit({ limiter: rateLimit('100/minute') })
const uploadLimiter = bunRateLimit({ limiter: rateLimit('5/minute') })

Bun.serve({
  async fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname.startsWith('/api/upload')) {
      const denied = await uploadLimiter(req, server)
      if (denied) return denied
    } else {
      const denied = await apiLimiter(req, server)
      if (denied) return denied
    }

    return new Response('OK')
  },
})
```

---

## Deno

```ts
import { denoRateLimit, withDenoRateLimit } from '@tzezar/throtto/adapters/deno'
```

Two exports for `Deno.serve`. Both receive `(req, info)` where `info` has `remoteAddr`.

- **`denoRateLimit(config)`** — returns `(req, info) => Promise<Response | null>`. Returns `null` when allowed.
- **`withDenoRateLimit(config, handler)`** — wraps a handler: `(req, info) => Promise<Response>`.

### With `denoRateLimit`

```ts
import { denoRateLimit } from '@tzezar/throtto/adapters/deno'
import { rateLimit } from '@tzezar/throtto'

const rl = denoRateLimit({ limiter: rateLimit('100/minute') })

Deno.serve(async (req, info) => {
  const denied = await rl(req, info)
  if (denied) return denied
  return new Response('OK')
})
```

### With `withDenoRateLimit`

```ts
import { withDenoRateLimit } from '@tzezar/throtto/adapters/deno'
import { rateLimit } from '@tzezar/throtto'

Deno.serve(withDenoRateLimit({ limiter: rateLimit('100/minute') }, async (req, info) => {
  return new Response('OK')
}))
```

### Per-endpoint (path-based)

```ts
const apiLimiter = denoRateLimit({ limiter: rateLimit('100/minute') })
const authLimiter = denoRateLimit({ limiter: rateLimit('5/15m') })

Deno.serve(async (req, info) => {
  const url = new URL(req.url)

  if (url.pathname.startsWith('/auth')) {
    const denied = await authLimiter(req, info)
    if (denied) return denied
  } else {
    const denied = await apiLimiter(req, info)
    if (denied) return denied
  }

  return new Response('OK')
})
```

---

## Generic HTTP

```ts
import { createHttpRateLimiter, createHttpChecker } from '@tzezar/throtto/adapters/http'
```

Two exports for any framework that uses the standard `Request`/`Response` API - including custom servers, test harnesses, and edge runtimes.

- **`createHttpRateLimiter(config)`** — returns `(req: Request) => Promise<Response | null>`. Returns `null` when allowed, or a deny `Response`.
- **`createHttpChecker(config)`** — returns `(req: Request) => Promise<HttpRateLimitResult>`. Returns the raw result object for custom handling.

### With `createHttpRateLimiter`

```ts
import { createHttpRateLimiter } from '@tzezar/throtto/adapters/http'
import { rateLimit } from '@tzezar/throtto'

const rl = createHttpRateLimiter({ limiter: rateLimit('100/minute') })

async function handler(request: Request): Promise<Response> {
  const denied = await rl(request)
  if (denied) return denied
  return new Response('OK')
}
```

### With `createHttpChecker`

```ts
import { createHttpChecker } from '@tzezar/throtto/adapters/http'
import { rateLimit } from '@tzezar/throtto'

const check = createHttpChecker({ limiter: rateLimit('100/minute') })

async function handler(request: Request): Promise<Response> {
  const result = await check(request)
  if (!result.allowed) {
    return new Response('Custom deny page', { status: 429, headers: result.headers })
  }
  return new Response('OK', { headers: result.headers })
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

All three are exported from `@tzezar/throtto/http` and are used internally by every built-in adapter.

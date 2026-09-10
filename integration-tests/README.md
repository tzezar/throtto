# throtto - Real-World Integration Tests

Example apps testing `@tzezar/throtto` with real frameworks and adapters.

## Apps

| App | Framework/Adapter | Tests | Runtime | Status |
|---|---|---|---|---|
| `express-app` | Express 5 | 13 | Node | ✅ |
| `hono-app` | Hono 4 | 13 | Node | ✅ |
| `fastify-app` | Fastify 5 | 13 | Node | ✅ |
| `koa-app` | Koa 2 | 13 | Node | ✅ |
| `h3-app` | H3 (Nuxt) | 12 | Node | ✅ |
| `generic-http-app` | Node.js native HTTP | 22 | Node | ✅ |
| `nextjs-app` | Next.js (`withRateLimit`) | 12 | Node | ✅ |
| `sveltekit-app` | SvelteKit (`sveltekitRateLimit`) | 12 | Node | ✅ |
| `remix-app` | Remix (`withRemixRateLimit`) | 12 | Node | ✅ |
| `astro-app` | Astro (`astroRateLimit`) | 12 | Node | ✅ |
| `nestjs-app` | NestJS (`createThrottleGuard`) | 12 | Node | ✅ |
| `trpc-app` | tRPC (`trpcRateLimit`) | 8 | Node | ✅ |
| `websocket-app` | WebSocket (`createWebSocketLimiter`) | 15 | Node | ✅ |
| `lambda-app` | AWS Lambda (`withLambdaRateLimit`) | 9 | Node | ✅ |
| `cluster-app` | Node.js cluster (`clusterStore`) | 12 | Node | ✅ |
| `elysia-app` | Elysia (`elysiaRateLimit`) | 16 | Bun | ✅ |
| `bun-app` | Bun (`bunRateLimit`) | 12 | Bun | ✅ |
| `deno-app` | Deno (`denoRateLimit`) | 12 | Deno | ✅ |

**Total: 18 apps, 220 integration tests, all passing.**

### Not tested

| Adapter | Reason |
|---|---|
| CloudFlare Workers | Requires Wrangler/CF runtime |

## Run all tests

### Node apps
```bash
for app in express-app hono-app fastify-app koa-app h3-app generic-http-app \
           nextjs-app sveltekit-app remix-app astro-app nestjs-app \
           trpc-app websocket-app lambda-app cluster-app; do
  echo "=== $app ==="
  cd $app && pnpm install --ignore-scripts && pnpm test && cd ..
done
```

### Bun apps
```bash
for app in elysia-app bun-app; do
  echo "=== $app ==="
  cd $app && bun install && bun run test.ts && cd ..
done
```

### Deno app
```bash
cd deno-app && deno run --allow-net --allow-read test.ts && cd ..
```

## cluster-app

Unlike the other apps, `cluster-app` forks real worker processes. `test.ts` acts
as the cluster primary, points `cluster.setupPrimary({ exec })` at `server.ts`,
and asserts that a limit of 10 stays 10 across 4 workers. It then reruns the
same load with `memoryStore()` as a control, which leaks 40 - the `N x limit`
problem `clusterStore()` exists to solve.

Run the server on its own to poke at it by hand:

```bash
cd cluster-app
pnpm start                          # 4 workers, 10/min, http://localhost:3018
WORKERS=8 LIMIT=20 pnpm start
STORE=memory pnpm start             # watch the limit leak

for i in $(seq 1 15); do curl -s localhost:3018/; echo; done
```

Each response reports which worker served it:

```json
{"ok":true,"worker":3,"pid":211867}
```

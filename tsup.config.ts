import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // ─── Stores ───────────────────────────────────────────────────────────
    'stores/memory': 'src/stores/memory.ts',
    'stores/redis': 'src/stores/redis.ts',
    'stores/upstash': 'src/stores/upstash.ts',
    'stores/postgres': 'src/stores/postgres.ts',
    'stores/mysql': 'src/stores/mysql.ts',
    'stores/sqlite': 'src/stores/sqlite.ts',
    'stores/schemas/index': 'src/stores/schemas/index.ts',
    // ─── HTTP ─────────────────────────────────────────────────────────────
    'http/index': 'src/http/index.ts',
    // ─── Framework Adapters ───────────────────────────────────────────────
    'adapters/http': 'src/adapters/http.ts',
    'adapters/express': 'src/adapters/express.ts',
    'adapters/hono': 'src/adapters/hono.ts',
    'adapters/fastify': 'src/adapters/fastify.ts',
    'adapters/nestjs': 'src/adapters/nestjs.ts',
    'adapters/nextjs': 'src/adapters/nextjs.ts',
    'adapters/elysia': 'src/adapters/elysia.ts',
    'adapters/h3': 'src/adapters/h3.ts',
    'adapters/trpc': 'src/adapters/trpc.ts',
    'adapters/websocket': 'src/adapters/websocket.ts',
    'adapters/koa': 'src/adapters/koa.ts',
    'adapters/sveltekit': 'src/adapters/sveltekit.ts',
    'adapters/remix': 'src/adapters/remix.ts',
    'adapters/astro': 'src/adapters/astro.ts',
    'adapters/lambda': 'src/adapters/lambda.ts',
    'adapters/cloudflare-workers': 'src/adapters/cloudflare-workers.ts',
    'adapters/bun': 'src/adapters/bun.ts',
    'adapters/deno': 'src/adapters/deno.ts',
    // ─── DX ───────────────────────────────────────────────────────────────
    'decorators/index': 'src/decorators/index.ts',
    'cli/index': 'src/cli/index.ts',
    'testing/index': 'src/testing/index.ts',
    // ─── Extras ───────────────────────────────────────────────────────────
    'analytics/index': 'src/analytics/index.ts',
  },
  external: ['ioredis', '@upstash/redis', 'pg', 'mysql2', 'better-sqlite3'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  target: 'es2022',
})

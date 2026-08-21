# Storage Adapters

All stores implement the same `Store` interface - swap backends without changing application code.

## Memory (default)

Zero config. Used automatically when no store is specified:

```ts
import { rateLimit } from '@tzezar/throtto'

const limiter = rateLimit('100/minute')
// ↑ uses memoryStore() internally
```

For explicit configuration:

```ts
import { memoryStore } from '@tzezar/throtto/stores/memory'

const store = memoryStore({
  maxEntries: 10_000,       // LRU eviction limit
  cleanupInterval: 60_000,  // cleanup expired entries every 60s
})
```

## Redis

Production multi-instance deployments:

```ts
import { rateLimit } from '@tzezar/throtto'
import { redisStore } from '@tzezar/throtto/stores/redis'
import Redis from 'ioredis'

const client = new Redis('redis://localhost:6379')

const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: redisStore({
    client,
    prefix: 'rl:',
    disconnectOnShutdown: false,  // don't close shared connections
  }),
})
```

**Install**: `npm install ioredis`

Uses Lua CAS scripts for atomic operations - safe across multiple instances.

## Upstash (serverless)

HTTP-based, no persistent connections:

```ts
import { upstashStore } from '@tzezar/throtto/stores/upstash'
import { Redis } from '@upstash/redis'

const client = new Redis({
  url: 'https://your-instance.upstash.io',
  token: 'your-token',
})

const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: upstashStore({ client, prefix: 'rl:' }),
})
```

**Install**: `npm install @upstash/redis`

## PostgreSQL

Use your existing database - no extra infrastructure:

```ts
import { postgresStore } from '@tzezar/throtto/stores/postgres'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: 'postgres://...' })

const limiter = rateLimit({
  limit: 100,
  window: '1m',
  store: postgresStore({
    pool,
    ensureTable: true,         // auto-create table on first use
    cleanupInterval: 300_000,  // cleanup expired rows every 5 min
  }),
})
```

**Install**: `npm install pg`

Also available: `mysqlStore` (mysql2) and `sqliteStore` (better-sqlite3) with identical patterns.

## Schema generation

For SQL stores, generate the table schema:

```bash
npx @tzezar/throtto schema --store postgres --format sql
npx @tzezar/throtto schema --store mysql --format drizzle
npx @tzezar/throtto schema --store sqlite --format prisma
```

Or via API:

```ts
import { getSchema, getDrizzleSchema, getPrismaSchema } from '@tzezar/throtto/schemas'

const sql = getSchema('postgres')
const drizzle = getDrizzleSchema()
const prisma = getPrismaSchema()
```

## Cache layer

Combine a fast local cache with a remote store:

```ts
import { withCache } from '@tzezar/throtto'
import { redisStore } from '@tzezar/throtto/stores/redis'

const store = withCache(redisStore({ client }), {
  localTtl: 5000,         // cache locally for 5s
  maxLocalEntries: 1000,
})
```

## Store health & maintenance

```ts
// Health check
await store.ping?.()          // true if reachable

// List keys
await store.keys?.('api:')    // keys with prefix (memory + redis)

// Cleanup expired (SQL stores)
await store.cleanup?.()       // returns count of deleted rows

// Shutdown
await store.shutdown?.()
```

---

Next: [Testing](./testing.md) · [Store deep-dive](../docs/stores.md)

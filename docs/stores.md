# Storage Adapters

## Overview

All stores implement the same `Store` interface - swap backends without changing application code.

```ts
interface Store {
  get(key: string): Promise<StoreEntry | null>
  set(key: string, entry: StoreEntry, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  atomic?(key: string, updater: (current: StoreEntry | null) => StoreEntry, ttlMs: number): Promise<StoreEntry>  // optional
  shutdown?(): Promise<void>                           // optional
  keys?(prefix?: string): Promise<string[]>            // optional
  ping?(): Promise<boolean>                            // optional
}
```

Every `StoreEntry` carries three fields:

```ts
interface StoreEntry {
  state: Record<string, unknown>  // algorithm-specific data
  expiresAt: number               // Unix ms timestamp
  createdAt: number               // Unix ms timestamp
  algorithmType?: string           // used for algorithm mismatch detection
}
```

---

## Quick Comparison

| Store | Peer Dep | Distributed | Persistence | Atomic | Cleanup | Best For |
|---|---|---|---|---|---|---|
| **Memory** | None | No | No | Yes | Auto | Dev, single-process |
| **Cluster** | None | Single host | No | Yes (primary-owned) | Auto | Node cluster / PM2, no Redis |
| **Redis** | `ioredis` | Yes | Optional | Yes (Lua CAS) | TTL-based | Production multi-instance |
| **Upstash** | `@upstash/redis` | Yes | Yes | Yes (Lua CAS) | TTL-based | Serverless, edge |
| **PostgreSQL** | `pg` | Yes | Yes | Yes (`FOR UPDATE`) | Manual / auto | Already have Postgres |
| **MySQL** | `mysql2` | Yes | Yes | Yes (`FOR UPDATE`) | Manual / auto | Already have MySQL |
| **SQLite** | `better-sqlite3` | No | Yes | Yes (transaction) | Manual / auto | Embedded, single-server |

---

## Memory Store

```ts
import { memoryStore } from '@tzezar/throtto/stores/memory'

// Zero-config (used by default when no store is provided)
const store = memoryStore()

// With options
const store = memoryStore({
  maxEntries: 10_000,        // LRU eviction limit (default: Infinity)
  cleanupInterval: 60_000,   // sweep expired entries every 60s (default: 60000, 0 = disabled)
  onEviction: (key, entry) => console.log(`Evicted: ${key}`),
})
```

**When to use:** Development, testing, single-process apps.

**Notes:**
- Default store if none is specified.
- Data is lost on restart.
- Passive TTL check on every `get()` - expired entries return `null` and are deleted.
- Active cleanup runs on an interval to reclaim memory from entries that expired without being read.
- Set `cleanupInterval: 0` in tests or serverless functions to avoid dangling timers.

---

## Cluster Store

Shares rate limit state across Node.js cluster workers over the IPC channel they already have - no Redis, no extra infrastructure.

```ts
import { clusterStore } from '@tzezar/throtto/stores/cluster'

const store = clusterStore({
  maxEntries: 10_000,   // LRU limit on the primary (default: Infinity)
})

const limiter = rateLimit({ limit: 100, window: '1m', store })
```

The same call runs in the primary and in every worker - the role is detected automatically.

**Install:** nothing. It ships as a separate entry point so `node:cluster` is never pulled into browser, edge, or serverless bundles.

### Why

In a cluster, each worker has its own heap. With `memoryStore()` a limit of 100 becomes `N x 100` - one bucket per worker. The cluster store keeps a single bucket on the primary.

```ts
import cluster from 'node:cluster'
import { availableParallelism } from 'node:os'
import { rateLimit } from '@tzezar/throtto/adapters/express'
import { clusterStore } from '@tzezar/throtto/stores/cluster'

const store = clusterStore({ maxEntries: 50_000 })

if (cluster.isPrimary) {
  // The primary only holds state - it answers worker requests over IPC.
  await store.ready()
  for (let i = 0; i < availableParallelism(); i++) cluster.fork()
} else {
  const app = express()
  app.use(rateLimit({ limit: 100, window: '1m', store }))
  app.listen(3000)
}
```

### How it works

| Side | Responsibility |
|---|---|
| Primary | Owns the state, applies every write, sweeps expired entries, enforces the LRU |
| Worker | Proxies `get`/`set`/`atomic` over IPC and awaits the reply |

Writes take one of two paths:

- **Optimistic (1 round trip).** Every mutation on the primary bumps a monotonic version. A worker remembers the version it last wrote and folds read and write into a single compare-and-swap. This is the normal case.
- **Fair (2 round trips).** Once a key shows contention, the worker stops guessing and takes a FIFO turn on the primary: `lock` -> run the algorithm -> `commit`. Competing workers queue instead of starving each other, and no update is ever lost.

Because the primary is single-threaded, its event loop serializes every write - there is no distributed locking and no retry storm. A worker that dies mid-update has its lock force-released after `lockTimeout`.

### Performance

Measured on Node 22 with 4 forked workers (`tests/fixtures/cluster-harness.ts`):

| Scenario | Per-check overhead |
|---|---|
| Distinct keys per worker (typical) | ~0.05 ms |
| Every worker on one hot key | ~0.15 - 0.4 ms |

### Options

```ts
const store = clusterStore({
  maxEntries: 10_000,      // LRU limit on the primary (default: Infinity)
  cleanupInterval: 60_000, // primary sweep for expired entries (default: 60000, 0 = off)
  onEviction: (key) => {}, // fired on the primary

  role: 'worker',          // override auto-detection (default: auto)
  namespace: 'api',        // isolate multiple stores on one IPC channel (default: 'default')

  timeout: 1000,           // ms to wait for a primary reply (default: 1000)
  lockTimeout: 1000,       // ms before a held key lock is force-released (default: 1000)
  maxRetries: 3,           // commit attempts on a contended key (default: 3)
  cacheEntries: 1000,      // worker-side version cache size (default: 1000)

  onUnreachable: 'local',  // 'local' | 'error' (default: 'local')
  retryInterval: 5000,     // ms to stay degraded before probing again (default: 5000)
  onDegraded: (error) => console.warn('cluster primary unreachable', error),
  onRecovered: () => console.info('cluster primary back'),

  transport: myTransport,  // custom IPC bus (see below)
})
```

The returned store adds three members on top of the `Store` interface:

```ts
await store.ready()   // resolves once this process is wired to the IPC channel
store.isPrimary       // true when this process owns the state
store.degraded        // true while a worker is running on local fallback state
```

### Graceful degradation

If the primary stops answering - it crashed, is blocked, or the channel closed - a worker does **not** hang:

| `onUnreachable` | Behaviour |
|---|---|
| `'local'` (default) | Falls back to a per-worker in-memory store. Limits are still enforced, just per worker instead of globally. |
| `'error'` | Throws a `StoreError`, so the limiter's own `failMode` (`'open'` or `'closed'`) decides. |

After degrading, the worker skips IPC entirely for `retryInterval` ms, then probes again. A successful reply clears the degraded flag and fires `onRecovered`.

```ts
const store = clusterStore({ onUnreachable: 'error' })

const limiter = createLimiter({
  algorithm: slidingWindowCounter({ limit: 100, window: '1m' }),
  store,
  failMode: 'closed',   // reject requests rather than let them through unlimited
})
```

### PM2 and other topologies

PM2's cluster mode forks real cluster workers, but the process that owns the IPC channel is the PM2 daemon, not your code - so there is no primary running `clusterStore()` to answer. Two options:

1. **Run your own primary.** Start a single PM2 process (`-i 1`) that forks workers with `node:cluster` itself. This is the plain Node setup above and needs no extra configuration.
2. **Plug in a transport.** Anything that can carry request/response messages works:

```ts
import type { ClusterTransport } from '@tzezar/throtto/stores/cluster'

const transport: ClusterTransport = {
  role: 'worker',
  listen(handler) {},                       // primary: receive requests, reply via peer.send()
  subscribe(handler) { bus.on('msg', handler) }, // worker: receive replies
  send(message) { return bus.publish(message) }, // worker: send a request
  isConnected() { return bus.connected },
  close() { bus.off('msg') },
}

const store = clusterStore({ transport })
```

The same hook is how `child_process.fork()` trees, `MessagePort`, and the in-process test double are supported.

**Notes:**
- State lives in one process's memory: it is shared across workers on **one host**, not across machines. Use Redis for multi-host deployments.
- Messages are plain JSON-serializable objects, so both Node's default IPC serialization and `advanced` (structured clone) work unchanged.
- Data is lost when the primary restarts, exactly like the memory store.

---

## Redis Store

```ts
import { redisStore } from '@tzezar/throtto/stores/redis'
import Redis from 'ioredis'

const client = new Redis('redis://localhost:6379')

const store = redisStore({
  client,
  prefix: 'throtto:',             // key prefix (default: 'throtto:')
  disconnectOnShutdown: false,     // don't close a shared connection (default: false)
})
```

**Install:** `npm install ioredis`

**Atomic operations:** Uses a Lua compare-and-swap (CAS) script for race-free updates. The script returns the current value on CAS failure, eliminating an extra `GET` round trip on retry. Up to 10 retries, then a forced `SET` as a last resort.

**TTL:** Automatic via Redis `SET ... PX <ms>`. No manual cleanup needed.

**`ping()` and `keys()` usage:**

```ts
// Health check - runs PING via eval
const healthy = await store.ping()   // true | false

// List keys by prefix (strips the store prefix from results)
const keys = await store.keys('api:')  // e.g. ['api:user:1', 'api:user:2']
```

**When to use:** Production, multi-instance deployments behind a load balancer.

---

## Upstash Store

```ts
import { upstashStore } from '@tzezar/throtto/stores/upstash'
import { Redis } from '@upstash/redis'

const client = new Redis({
  url: 'https://your-instance.upstash.io',
  token: 'your-token',
})

const store = upstashStore({
  client,
  prefix: 'throtto:',   // key prefix (default: 'throtto:')
})
```

**Install:** `npm install @upstash/redis`

**When to use:** Serverless (Vercel, Cloudflare Workers, Deno Deploy, AWS Lambda), edge runtimes.

**Notes:**
- HTTP-based - no persistent TCP connections, safe for ephemeral runtimes.
- Handles Upstash's auto-JSON deserialization transparently (works whether values come back as strings or parsed objects).
- `shutdown()` is a no-op since there are no connections to close.
- Lua CAS script support via the Upstash REST API for atomic operations.

---

## PostgreSQL Store

```ts
import { postgresStore, ensurePostgresTable } from '@tzezar/throtto/stores/postgres'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: 'postgres://user:pass@localhost:5432/mydb' })

// Auto-create table on first use
const store = postgresStore({
  pool,
  tableName: 'throtto_rate_limits',  // default
  schema: 'public',                  // default
  ensureTable: true,                 // auto-create on first operation (default: false)
  cleanupInterval: 300_000,          // sweep expired rows every 5min (default: 0 = disabled)
})

// Or create the table manually (e.g. during migrations)
await ensurePostgresTable(pool, {
  tableName: 'throtto_rate_limits',
  schema: 'public',
})
```

**Install:** `npm install pg`

**Atomicity:** Uses `SELECT ... FOR UPDATE` inside a transaction for row-level locking.

**Cleanup:**

```ts
// Manually delete expired rows - returns count of deleted rows
const deleted = await store.cleanup()
```

**When to use:** You already run Postgres and want persistence without adding Redis.

---

## MySQL Store

Same pattern as Postgres:

```ts
import { mysqlStore, ensureMySqlTable } from '@tzezar/throtto/stores/mysql'
import mysql from 'mysql2/promise'

const pool = await mysql.createPool('mysql://user:pass@localhost:3306/mydb')

const store = mysqlStore({
  pool,
  tableName: 'throtto_rate_limits',  // default
  ensureTable: true,                 // auto-create on first operation (default: false)
  cleanupInterval: 300_000,          // sweep expired rows every 5min (default: 0 = disabled)
})

// Or create the table manually
await ensureMySqlTable(pool, { tableName: 'throtto_rate_limits' })
```

**Install:** `npm install mysql2`

**Atomicity:** `SELECT ... FOR UPDATE` with InnoDB row-level locking, `INSERT ... ON DUPLICATE KEY UPDATE` for upserts.

**Cleanup:**

```ts
const deleted = await store.cleanup()
```

**When to use:** You already run MySQL and want persistence without adding Redis.

---

## SQLite Store

```ts
import { sqliteStore, ensureSqliteTable } from '@tzezar/throtto/stores/sqlite'
import Database from 'better-sqlite3'

const db = new Database('./rate-limits.db')

const store = sqliteStore({
  db,
  tableName: 'throtto_rate_limits',  // default
  ensureTable: true,                 // auto-create on first operation (default: false)
  cleanupInterval: 300_000,          // sweep expired rows every 5min (default: 0 = disabled)
})

// Or create the table manually
ensureSqliteTable(db, { tableName: 'throtto_rate_limits' })  // synchronous
```

**Install:** `npm install better-sqlite3`

**Notes:**
- `better-sqlite3` is synchronous. All methods still return promises to satisfy the `Store` interface.
- Transactions are truly atomic - `db.transaction()` serializes access, eliminating race conditions.
- Prepared statements are created lazily and reused for performance.
- Good for embedded apps, CLI tools, and single-server deployments.

**Cleanup:**

```ts
const deleted = await store.cleanup()
```

---

## Cache Layer

Combine a local in-memory cache with a remote store for lower latency:

```ts
import { withCache } from '@tzezar/throtto'
import { redisStore } from '@tzezar/throtto/stores/redis'
import Redis from 'ioredis'

const client = new Redis('redis://localhost:6379')

const store = withCache(redisStore({ client }), {
  localTtl: 5000,            // cache entries locally for 5 seconds (default: 5000)
  maxLocalEntries: 1000,     // max local cache size (default: 1000)
})
```

**How it works:**

| Operation | Behavior |
|---|---|
| `get()` | Check local cache first. If fresh, return immediately. Otherwise fall through to remote, then cache the result locally. |
| `set()` | Write to both local cache and remote store. |
| `delete()` | Remove from both local cache and remote store. |
| `clear()` | Clear both local cache and remote store. |
| `atomic()` | Delegated to the remote store's `atomic()`. Result is cached locally. Falls back to non-atomic get-update-set if the remote store lacks `atomic()`. |
| `shutdown()` | Clears local cache, then calls `shutdown()` on the remote store. |

**When to use:** High-throughput APIs where Redis round-trip latency matters. Accepts slightly stale data (within `localTtl`) in exchange for near-zero latency on hot keys.

---

## Schema Generation

For SQL stores, generate table schemas programmatically or from the CLI.

### Via API

```ts
import { getSchema, getDrizzleSchema, getPrismaSchema } from '@tzezar/throtto/schemas'

// Raw CREATE TABLE SQL
const pgSql     = getSchema('postgres')
const mysqlSql  = getSchema('mysql')
const sqliteSql = getSchema('sqlite')

// With custom table name and schema
const customSql = getSchema('postgres', {
  tableName: 'my_limits',
  schema: 'app',
})

// Drizzle ORM schema (PostgreSQL)
const drizzle = getDrizzleSchema()
const drizzle = getDrizzleSchema({ tableName: 'my_limits', schema: 'app' })

// Prisma model block
const prisma = getPrismaSchema()
const prisma = getPrismaSchema({ tableName: 'my_limits' })
```

### Via CLI

```bash
npx @tzezar/throtto schema --store postgres --format sql
npx @tzezar/throtto schema --store mysql    --format sql
npx @tzezar/throtto schema --store sqlite   --format sql
npx @tzezar/throtto schema --store postgres --format drizzle
npx @tzezar/throtto schema --store postgres --format prisma
```

The CLI accepts `--table-name` and `--schema` flags for customization.

---

## Custom Store

Implement the `Store` interface to integrate any backend:

```ts
import type { Store, StoreEntry } from '@tzezar/throtto'

function myStore(): Store {
  const data = new Map<string, { entry: StoreEntry; expiresAt: number }>()

  return {
    async get(key) {
      const record = data.get(key)
      if (!record || record.expiresAt <= Date.now()) {
        data.delete(key)
        return null
      }
      return record.entry
    },

    async set(key, entry, ttlMs) {
      data.set(key, { entry, expiresAt: Date.now() + ttlMs })
    },

    async delete(key) {
      data.delete(key)
    },

    async clear() {
      data.clear()
    },

    // Optional but recommended for correctness under concurrency:
    async atomic(key, updater, ttlMs) {
      const current = await this.get(key)
      const updated = updater(current)
      await this.set(key, updated, ttlMs)
      return updated
    },

    async shutdown() {
      data.clear()
    },

    async ping() {
      return true
    },

    async keys(prefix) {
      const result: string[] = []
      for (const key of data.keys()) {
        if (!prefix || key.startsWith(prefix)) {
          result.push(key)
        }
      }
      return result
    },
  }
}
```

> **Tip:** If your store supports native atomic primitives (transactions, CAS, Lua scripts), implement `atomic()` using them instead of the get-update-set fallback shown above. This prevents race conditions under concurrent access.

---

## Store Health & Maintenance

All stores expose optional methods for operational use:

```ts
// Health check - returns true if the store is reachable
const healthy = await store.ping?.()

// List keys matching a prefix
const keys = await store.keys?.('api:')

// Cleanup expired rows (SQL stores only - returns count of deleted rows)
const deleted = await store.cleanup?.()

// Graceful shutdown - clears timers, releases resources
await store.shutdown?.()
```

### Recommended Startup Pattern

```ts
const store = postgresStore({
  pool,
  ensureTable: true,
  cleanupInterval: 300_000,
})

// Verify connectivity before accepting traffic
const ok = await store.ping?.()
if (!ok) throw new Error('Store is not reachable')
```

### Graceful Shutdown

```ts
process.on('SIGTERM', async () => {
  await store.shutdown?.()
  process.exit(0)
})
```

For SQL stores, `shutdown()` clears the cleanup interval timer. It does **not** close the database pool - you manage pool lifecycle yourself.

---

## Atomicity

All built-in stores implement `atomic()` - race-free read-modify-write in a single operation:

| Store | Mechanism |
|-------|----------|
| Memory | Synchronous updater (single-process, no race possible) |
| Cluster | Versioned CAS on the primary, with a FIFO key lock for contended keys |
| Redis | Lua compare-and-swap script with retries |
| Upstash | Lua CAS via REST API |
| PostgreSQL | `SELECT ... FOR UPDATE` (row-level lock) |
| MySQL | `SELECT ... FOR UPDATE` (InnoDB row-level lock) |
| SQLite | `db.transaction()` (serialized) |

The limiter automatically uses `atomic()` when available. If a custom store omits it, the limiter falls back to get-then-set (safe for single-process only).

You don't need to configure anything - atomicity is the default behavior with every built-in store.

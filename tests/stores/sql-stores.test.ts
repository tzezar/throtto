import { beforeEach, describe, expect, it } from 'vitest'
import type { MySqlConnection, MySqlPool, MySqlRows } from '../../src/stores/mysql.js'
import { mysqlStore } from '../../src/stores/mysql.js'
import type { PgClient, PgPool } from '../../src/stores/postgres.js'
import { postgresStore } from '../../src/stores/postgres.js'
import { getDrizzleSchema, getPrismaSchema, getSchema } from '../../src/stores/schemas/index.js'
import type { SqliteDatabase, SqliteStatement } from '../../src/stores/sqlite.js'
import { sqliteStore } from '../../src/stores/sqlite.js'
import { runStoreConformanceTests } from './store-conformance.test.js'

// ─── Mock Storage Backend ────────────────────────────────────────────────────

interface StoredRow {
  key: string
  state: string
  expires_at: number
  created_at: number
}

function createInMemoryRows(): Map<string, StoredRow> {
  return new Map()
}

// ─── Mock PostgreSQL Pool ────────────────────────────────────────────────────

function createMockPgPool(): PgPool & { _rows: Map<string, StoredRow> } {
  const rows = createInMemoryRows()

  function executeQuery(text: string, values: unknown[] = []): { rows: Record<string, unknown>[] } {
    const trimmed = text.replace(/\s+/g, ' ').trim()

    // CREATE TABLE / CREATE INDEX
    if (trimmed.startsWith('CREATE')) {
      return { rows: [] }
    }

    // SELECT with expiry check
    if (trimmed.includes('SELECT') && trimmed.includes('expires_at >')) {
      const key = values[0] as string
      const now = values[1] as number
      const row = rows.get(key)
      if (row && row.expires_at > now) {
        return {
          rows: [{ state: row.state, expires_at: row.expires_at, created_at: row.created_at }],
        }
      }
      return { rows: [] }
    }

    // SELECT FOR UPDATE (no expiry filter)
    if (trimmed.includes('SELECT') && trimmed.includes('FOR UPDATE')) {
      const key = values[0] as string
      const row = rows.get(key)
      if (row) {
        return {
          rows: [{ state: row.state, expires_at: row.expires_at, created_at: row.created_at }],
        }
      }
      return { rows: [] }
    }

    // INSERT ... ON CONFLICT
    if (trimmed.includes('INSERT')) {
      const key = values[0] as string
      const state = values[1] as string
      const expiresAt = values[2] as number
      const createdAt = values[3] as number
      rows.set(key, { key, state, expires_at: expiresAt, created_at: createdAt })
      return { rows: [] }
    }

    // DELETE with key
    if (trimmed.includes('DELETE') && trimmed.includes('WHERE')) {
      const key = values[0] as string
      rows.delete(key)
      return { rows: [] }
    }

    // DELETE all (clear)
    if (trimmed.includes('DELETE')) {
      rows.clear()
      return { rows: [] }
    }

    // BEGIN / COMMIT / ROLLBACK
    if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      return { rows: [] }
    }

    return { rows: [] }
  }

  const pool: PgPool & { _rows: Map<string, StoredRow> } = {
    _rows: rows,
    async query(text: string, values?: unknown[]) {
      return executeQuery(text, values)
    },
    async connect(): Promise<PgClient> {
      return {
        async query(text: string, values?: unknown[]) {
          return executeQuery(text, values)
        },
        release() {},
      }
    },
  }

  return pool
}

// ─── Mock MySQL Pool ─────────────────────────────────────────────────────────

function createMockMySqlPool(): MySqlPool & { _rows: Map<string, StoredRow> } {
  const rows = createInMemoryRows()

  function executeQuery(sql: string, values: unknown[] = []): [MySqlRows, unknown] {
    const trimmed = sql.replace(/\s+/g, ' ').trim()

    // CREATE TABLE
    if (trimmed.startsWith('CREATE')) {
      return [[], null]
    }

    // SELECT with expiry check
    if (trimmed.includes('SELECT') && trimmed.includes('expires_at >')) {
      const key = values[0] as string
      const now = values[1] as number
      const row = rows.get(key)
      if (row && row.expires_at > now) {
        return [
          [{ state: row.state, expires_at: row.expires_at, created_at: row.created_at }],
          null,
        ]
      }
      return [[], null]
    }

    // SELECT FOR UPDATE
    if (trimmed.includes('SELECT') && trimmed.includes('FOR UPDATE')) {
      const key = values[0] as string
      const row = rows.get(key)
      if (row) {
        return [
          [{ state: row.state, expires_at: row.expires_at, created_at: row.created_at }],
          null,
        ]
      }
      return [[], null]
    }

    // INSERT
    if (trimmed.includes('INSERT')) {
      const key = values[0] as string
      const state = values[1] as string
      const expiresAt = values[2] as number
      const createdAt = values[3] as number
      rows.set(key, { key, state, expires_at: expiresAt, created_at: createdAt })
      return [[], null]
    }

    // DELETE with key
    if (trimmed.includes('DELETE') && trimmed.includes('WHERE')) {
      const key = values[0] as string
      rows.delete(key)
      return [[], null]
    }

    // DELETE all
    if (trimmed.includes('DELETE')) {
      rows.clear()
      return [[], null]
    }

    return [[], null]
  }

  const pool: MySqlPool & { _rows: Map<string, StoredRow> } = {
    _rows: rows,
    async query(sql: string, values?: unknown[]) {
      return executeQuery(sql, values)
    },
    async getConnection(): Promise<MySqlConnection> {
      return {
        async query(sql: string, values?: unknown[]) {
          return executeQuery(sql, values)
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      }
    },
  }

  return pool
}

// ─── Mock SQLite Database ────────────────────────────────────────────────────

function createMockSqliteDb(): SqliteDatabase & { _rows: Map<string, StoredRow> } {
  const rows = createInMemoryRows()

  function createStatement(sql: string): SqliteStatement {
    const trimmed = sql.replace(/\s+/g, ' ').trim()

    return {
      run(...params: unknown[]) {
        // UPSERT
        if (trimmed.includes('INSERT')) {
          const key = params[0] as string
          const state = params[1] as string
          const expiresAt = params[2] as number
          const createdAt = params[3] as number
          rows.set(key, { key, state, expires_at: expiresAt, created_at: createdAt })
          return { changes: 1 }
        }
        // DELETE with key
        if (trimmed.includes('DELETE') && trimmed.includes('WHERE')) {
          const key = params[0] as string
          const had = rows.has(key)
          rows.delete(key)
          return { changes: had ? 1 : 0 }
        }
        // DELETE all
        if (trimmed.includes('DELETE')) {
          const size = rows.size
          rows.clear()
          return { changes: size }
        }
        return { changes: 0 }
      },
      get(...params: unknown[]): Record<string, unknown> | undefined {
        // SELECT with expiry
        if (trimmed.includes('expires_at >')) {
          const key = params[0] as string
          const now = params[1] as number
          const row = rows.get(key)
          if (row && row.expires_at > now) {
            return { state: row.state, expires_at: row.expires_at, created_at: row.created_at }
          }
          return undefined
        }
        // SELECT without expiry (FOR UPDATE equivalent)
        if (trimmed.includes('SELECT')) {
          const key = params[0] as string
          const row = rows.get(key)
          if (row) {
            return { state: row.state, expires_at: row.expires_at, created_at: row.created_at }
          }
          return undefined
        }
        return undefined
      },
      all(): Record<string, unknown>[] {
        return Array.from(rows.values()).map((r) => ({
          state: r.state,
          expires_at: r.expires_at,
          created_at: r.created_at,
        }))
      },
    }
  }

  const db: SqliteDatabase & { _rows: Map<string, StoredRow> } = {
    _rows: rows,
    prepare(sql: string): SqliteStatement {
      return createStatement(sql)
    },
    exec(_sql: string): void {
      // CREATE TABLE etc. - no-op for mock
    },
    transaction<T>(fn: () => T): () => T {
      // SQLite transactions are synchronous; just run the function
      return () => fn()
    },
    close(): void {},
  }

  return db
}

// ─── PostgreSQL Tests ────────────────────────────────────────────────────────

describe('PostgreSQL Store', () => {
  let mockPool: ReturnType<typeof createMockPgPool>

  beforeEach(() => {
    mockPool = createMockPgPool()
  })

  it('get returns null for missing key', async () => {
    const store = postgresStore({ pool: mockPool })
    expect(await store.get('missing')).toBeNull()
  })

  it('set + get roundtrip', async () => {
    const store = postgresStore({ pool: mockPool })
    const entry = { state: { count: 5 }, expiresAt: Date.now() + 60_000, createdAt: Date.now() }
    await store.set('k1', entry, 60_000)
    const result = await store.get('k1')
    expect(result).not.toBeNull()
    expect(result?.state).toEqual({ count: 5 })
  })

  it('delete removes key', async () => {
    const store = postgresStore({ pool: mockPool })
    const entry = { state: {}, expiresAt: Date.now() + 60_000, createdAt: Date.now() }
    await store.set('k', entry, 60_000)
    await store.delete('k')
    expect(await store.get('k')).toBeNull()
  })

  it('clear removes all', async () => {
    const store = postgresStore({ pool: mockPool })
    const entry = { state: {}, expiresAt: Date.now() + 60_000, createdAt: Date.now() }
    await store.set('a', entry, 60_000)
    await store.set('b', entry, 60_000)
    await store.clear()
    expect(await store.get('a')).toBeNull()
    expect(await store.get('b')).toBeNull()
  })

  it('atomic creates and modifies', async () => {
    const store = postgresStore({ pool: mockPool })
    const r1 = await store.atomic?.(
      'counter',
      (cur) => ({
        state: { count: ((cur?.state?.count as number) ?? 0) + 1 },
        expiresAt: Date.now() + 60_000,
        createdAt: cur?.createdAt ?? Date.now(),
      }),
      60_000,
    )
    expect(r1.state).toEqual({ count: 1 })

    const r2 = await store.atomic?.(
      'counter',
      (cur) => ({
        state: { count: ((cur?.state?.count as number) ?? 0) + 1 },
        expiresAt: Date.now() + 60_000,
        createdAt: cur?.createdAt ?? Date.now(),
      }),
      60_000,
    )
    expect(r2.state).toEqual({ count: 2 })
  })

  it('ensureTable option creates table', async () => {
    const store = postgresStore({ pool: mockPool, ensureTable: true })
    // Should not throw
    await store.get('anything')
  })
})

// ─── MySQL Tests ─────────────────────────────────────────────────────────────

describe('MySQL Store', () => {
  let mockPool: ReturnType<typeof createMockMySqlPool>

  beforeEach(() => {
    mockPool = createMockMySqlPool()
  })

  it('get returns null for missing key', async () => {
    const store = mysqlStore({ pool: mockPool })
    expect(await store.get('missing')).toBeNull()
  })

  it('set + get roundtrip', async () => {
    const store = mysqlStore({ pool: mockPool })
    const entry = { state: { x: 10 }, expiresAt: Date.now() + 60_000, createdAt: Date.now() }
    await store.set('k1', entry, 60_000)
    const result = await store.get('k1')
    expect(result).not.toBeNull()
    expect(result?.state).toEqual({ x: 10 })
  })

  it('atomic creates and modifies', async () => {
    const store = mysqlStore({ pool: mockPool })
    await store.atomic?.(
      'c',
      (cur) => ({
        state: { n: ((cur?.state?.n as number) ?? 0) + 1 },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
      60_000,
    )
    const result = await store.get('c')
    expect(result?.state).toEqual({ n: 1 })
  })
})

// ─── SQLite Tests ────────────────────────────────────────────────────────────

describe('SQLite Store', () => {
  let mockDb: ReturnType<typeof createMockSqliteDb>

  beforeEach(() => {
    mockDb = createMockSqliteDb()
  })

  it('get returns null for missing key', async () => {
    const store = sqliteStore({ db: mockDb })
    expect(await store.get('missing')).toBeNull()
  })

  it('set + get roundtrip', async () => {
    const store = sqliteStore({ db: mockDb })
    const entry = { state: { val: 'hello' }, expiresAt: Date.now() + 60_000, createdAt: Date.now() }
    await store.set('k1', entry, 60_000)
    const result = await store.get('k1')
    expect(result).not.toBeNull()
    expect(result?.state).toEqual({ val: 'hello' })
  })

  it('atomic with transaction', async () => {
    const store = sqliteStore({ db: mockDb })
    const r = await store.atomic?.(
      'tx-key',
      (cur) => ({
        state: { step: ((cur?.state?.step as number) ?? 0) + 1 },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
      60_000,
    )
    expect(r.state).toEqual({ step: 1 })
  })
})

// ─── Schema Export Tests ─────────────────────────────────────────────────────

describe('Schema Export', () => {
  it('getSchema returns postgres SQL', () => {
    const sql = getSchema('postgres')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(sql).toContain('throtto_rate_limits')
    expect(sql).toContain('JSONB')
    expect(sql).toContain('VARCHAR(512)')
  })

  it('getSchema returns mysql SQL', () => {
    const sql = getSchema('mysql')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(sql).toContain('throtto_rate_limits')
    expect(sql).toContain('JSON')
    expect(sql).toContain('InnoDB')
  })

  it('getSchema returns sqlite SQL', () => {
    const sql = getSchema('sqlite')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(sql).toContain('throtto_rate_limits')
    expect(sql).toContain('TEXT')
  })

  it('getSchema respects custom tableName', () => {
    const sql = getSchema('postgres', { tableName: 'my_limits' })
    expect(sql).toContain('my_limits')
    expect(sql).not.toContain('throtto_rate_limits')
  })

  it('getSchema respects custom schema', () => {
    const sql = getSchema('postgres', { schema: 'app' })
    expect(sql).toContain('"app"')
  })

  it('getDrizzleSchema returns valid code', () => {
    const code = getDrizzleSchema()
    expect(code).toContain('pgTable')
    expect(code).toContain('throttoRateLimits')
    expect(code).toContain('primaryKey')
  })

  it('getDrizzleSchema respects custom tableName', () => {
    const code = getDrizzleSchema({ tableName: 'custom_limits' })
    expect(code).toContain('customLimits')
    expect(code).toContain("'custom_limits'")
  })

  it('getPrismaSchema returns valid model', () => {
    const schema = getPrismaSchema()
    expect(schema).toContain('model ThrottoRateLimits')
    expect(schema).toContain('@id')
    expect(schema).toContain('@@map("throtto_rate_limits")')
  })

  it('getPrismaSchema respects custom tableName', () => {
    const schema = getPrismaSchema({ tableName: 'api_limits' })
    expect(schema).toContain('model ApiLimits')
    expect(schema).toContain('@@map("api_limits")')
  })
})

// ─── Conformance Tests ───────────────────────────────────────────────────────
// Note: strictConcurrency is false because mocked SQL stores don't implement
// real row-level locking (SELECT ... FOR UPDATE). With a real database, the
// transactions would serialize properly and pass with strict concurrency.

runStoreConformanceTests(
  'PostgresStore (mocked)',
  () => postgresStore({ pool: createMockPgPool() }),
  { strictConcurrency: false },
)

runStoreConformanceTests('MySqlStore (mocked)', () => mysqlStore({ pool: createMockMySqlPool() }), {
  strictConcurrency: false,
})

runStoreConformanceTests('SqliteStore (mocked)', () => sqliteStore({ db: createMockSqliteDb() }), {
  strictConcurrency: false,
})

declare function setInterval(callback: () => void, ms: number): unknown
declare function clearInterval(handle: unknown): void

import type { Store, StoreEntry } from '../core/types.js'

// ─── PostgreSQL Client Interface ─────────────────────────────────────────────
// Minimal interface compatible with `pg` package Pool

export interface PgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  release(): void
}

export interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  connect(): Promise<PgClient>
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface PostgresStoreConfig {
  /** pg Pool instance (user provides) */
  pool: PgPool
  /** Table name. Default: 'throtto_rate_limits' */
  tableName?: string | undefined
  /** Schema name. Default: 'public' */
  schema?: string | undefined
  /** Auto-create table on first operation. Default: false */
  ensureTable?: boolean | undefined
  /** Interval in ms for automatic cleanup of expired rows. 0 = disabled. Default: 0 */
  cleanupInterval?: number | undefined
}

// ─── Schema SQL ──────────────────────────────────────────────────────────────

function getCreateTableSQL(schema: string, tableName: string): string {
  const qualifiedName = `"${schema}"."${tableName}"`
  return `
CREATE TABLE IF NOT EXISTS ${qualifiedName} (
  key VARCHAR(512) PRIMARY KEY,
  state JSONB NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_${tableName}_expires_at ON ${qualifiedName} (expires_at);
`.trim()
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Creates the rate limit table if it doesn't exist.
 * Call this during app startup or migration.
 */
export async function ensurePostgresTable(
  pool: PgPool,
  options?: { tableName?: string | undefined; schema?: string | undefined },
): Promise<void> {
  const tableName = options?.tableName ?? 'throtto_rate_limits'
  const schema = options?.schema ?? 'public'
  const sql = getCreateTableSQL(schema, tableName)
  await pool.query(sql)
}

// ─── Store Implementation ────────────────────────────────────────────────────

/**
 * PostgreSQL-backed store using `pg` Pool.
 *
 * Features:
 * - JSONB storage for state (queryable, indexable)
 * - SELECT ... FOR UPDATE for atomic operations (row-level locking)
 * - UPSERT via ON CONFLICT for set operations
 * - Index on expires_at for efficient cleanup queries
 * - Optional auto-table creation for development
 *
 * Note: User manages the Pool lifecycle (creation, shutdown).
 * Call `ensurePostgresTable()` during app initialization if needed.
 */
export function postgresStore(config: PostgresStoreConfig): Store & { cleanup(): Promise<number> } {
  const {
    pool,
    tableName = 'throtto_rate_limits',
    schema = 'public',
    ensureTable: autoEnsure = false,
    cleanupInterval = 0,
  } = config

  const qualifiedName = `"${schema}"."${tableName}"`
  let tableEnsured = !autoEnsure

  async function ensureTableExists(): Promise<void> {
    if (tableEnsured) return
    const sql = getCreateTableSQL(schema, tableName)
    await pool.query(sql)
    tableEnsured = true
  }

  function parseRow(row: Record<string, unknown>): StoreEntry | null {
    try {
      const state =
        typeof row.state === 'string'
          ? (JSON.parse(row.state as string) as Record<string, unknown>)
          : (row.state as Record<string, unknown>)
      const expiresAt = Number(row.expires_at)
      const createdAt = Number(row.created_at)

      if (!state || Number.isNaN(expiresAt) || Number.isNaN(createdAt)) return null
      return { state, expiresAt, createdAt }
    } catch {
      return null
    }
  }

  const store: Store & { cleanup(): Promise<number> } = {
    async get(key: string): Promise<StoreEntry | null> {
      await ensureTableExists()
      const result = await pool.query(
        `SELECT state, expires_at, created_at FROM ${qualifiedName} WHERE key = $1 AND expires_at > $2`,
        [key, Date.now()],
      )
      const row = result.rows[0]
      if (!row) return null
      return parseRow(row)
    },

    async set(key: string, entry: StoreEntry, _ttlMs: number): Promise<void> {
      await ensureTableExists()
      await pool.query(
        `INSERT INTO ${qualifiedName} (key, state, expires_at, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET state = $2, expires_at = $3`,
        [key, JSON.stringify(entry.state), entry.expiresAt, entry.createdAt],
      )
    },

    async delete(key: string): Promise<void> {
      await ensureTableExists()
      await pool.query(`DELETE FROM ${qualifiedName} WHERE key = $1`, [key])
    },

    async clear(): Promise<void> {
      await ensureTableExists()
      await pool.query(`DELETE FROM ${qualifiedName}`)
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      _ttlMs: number,
    ): Promise<StoreEntry> {
      await ensureTableExists()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        // Lock the row (or discover it doesn't exist)
        const result = await client.query(
          `SELECT state, expires_at, created_at FROM ${qualifiedName} WHERE key = $1 FOR UPDATE`,
          [key],
        )

        const row = result.rows[0]
        let current: StoreEntry | null = null

        if (row) {
          const parsed = parseRow(row)
          // Check if expired
          if (parsed && parsed.expiresAt > Date.now()) {
            current = parsed
          }
        }

        const updated = updater(current)

        await client.query(
          `INSERT INTO ${qualifiedName} (key, state, expires_at, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO UPDATE SET state = $2, expires_at = $3`,
          [key, JSON.stringify(updated.state), updated.expiresAt, updated.createdAt],
        )

        await client.query('COMMIT')
        return updated
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },

    async ping(): Promise<boolean> {
      try {
        await pool.query('SELECT 1')
        return true
      } catch {
        return false
      }
    },

    async cleanup(): Promise<number> {
      await ensureTableExists()
      const now = Date.now()
      // Count first, then delete (compatible with our minimal PgPool interface)
      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM ${qualifiedName} WHERE expires_at <= $1`,
        [now],
      )
      const count = Number(countResult.rows[0]?.cnt ?? 0)
      await pool.query(`DELETE FROM ${qualifiedName} WHERE expires_at <= $1`, [now])
      return count
    },

    async shutdown(): Promise<void> {
      if (cleanupTimer !== null) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
    },
  }

  let cleanupTimer: unknown = null

  if (cleanupInterval > 0) {
    cleanupTimer = setInterval(() => {
      void store.cleanup()
    }, cleanupInterval)
  }

  return store
}

declare function setInterval(callback: () => void, ms: number): unknown
declare function clearInterval(handle: unknown): void

import type { Store, StoreEntry } from '../core/types.js'

// ─── MySQL Client Interface ──────────────────────────────────────────────────
// Minimal interface compatible with mysql2/promise Pool

export interface MySqlPool {
  query(sql: string, values?: unknown[]): Promise<[MySqlRows, unknown]>
  getConnection(): Promise<MySqlConnection>
}

export interface MySqlConnection {
  query(sql: string, values?: unknown[]): Promise<[MySqlRows, unknown]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}

export type MySqlRows = Record<string, unknown>[]

// ─── Config ──────────────────────────────────────────────────────────────────

export interface MySqlStoreConfig {
  /** mysql2 Pool instance (user provides) */
  pool: MySqlPool
  /** Table name. Default: 'throtto_rate_limits' */
  tableName?: string | undefined
  /** Auto-create table on first operation. Default: false */
  ensureTable?: boolean | undefined
  /** Interval in ms for automatic cleanup of expired rows. 0 = disabled. Default: 0 */
  cleanupInterval?: number | undefined
}

// ─── Schema SQL ──────────────────────────────────────────────────────────────

function getCreateTableSQL(tableName: string): string {
  return `
CREATE TABLE IF NOT EXISTS \`${tableName}\` (
  \`key\` VARCHAR(512) NOT NULL PRIMARY KEY,
  \`state\` JSON NOT NULL,
  \`expires_at\` BIGINT NOT NULL,
  \`created_at\` BIGINT NOT NULL,
  INDEX idx_expires_at (\`expires_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`.trim()
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Creates the rate limit table if it doesn't exist.
 * Call this during app startup or migration.
 */
export async function ensureMySqlTable(
  pool: MySqlPool,
  options?: { tableName?: string | undefined },
): Promise<void> {
  const tableName = options?.tableName ?? 'throtto_rate_limits'
  const sql = getCreateTableSQL(tableName)
  await pool.query(sql)
}

// ─── Store Implementation ────────────────────────────────────────────────────

/**
 * MySQL-backed store using mysql2/promise Pool.
 *
 * Features:
 * - JSON column for state storage
 * - SELECT ... FOR UPDATE for atomic operations (row-level locking via InnoDB)
 * - UPSERT via INSERT ... ON DUPLICATE KEY UPDATE
 * - Index on expires_at for efficient cleanup
 * - Optional auto-table creation for development
 *
 * Note: User manages the Pool lifecycle.
 */
export function mysqlStore(config: MySqlStoreConfig): Store & { cleanup(): Promise<number> } {
  const {
    pool,
    tableName = 'throtto_rate_limits',
    ensureTable: autoEnsure = false,
    cleanupInterval = 0,
  } = config

  const escapedTable = `\`${tableName}\``
  let tableEnsured = !autoEnsure

  async function ensureTableExists(): Promise<void> {
    if (tableEnsured) return
    const sql = getCreateTableSQL(tableName)
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
      const [rows] = await pool.query(
        `SELECT state, expires_at, created_at FROM ${escapedTable} WHERE \`key\` = ? AND expires_at > ?`,
        [key, Date.now()],
      )
      const row = rows[0]
      if (!row) return null
      return parseRow(row)
    },

    async set(key: string, entry: StoreEntry, _ttlMs: number): Promise<void> {
      await ensureTableExists()
      await pool.query(
        `INSERT INTO ${escapedTable} (\`key\`, state, expires_at, created_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE state = VALUES(state), expires_at = VALUES(expires_at)`,
        [key, JSON.stringify(entry.state), entry.expiresAt, entry.createdAt],
      )
    },

    async delete(key: string): Promise<void> {
      await ensureTableExists()
      await pool.query(`DELETE FROM ${escapedTable} WHERE \`key\` = ?`, [key])
    },

    async clear(): Promise<void> {
      await ensureTableExists()
      await pool.query(`DELETE FROM ${escapedTable}`)
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      _ttlMs: number,
    ): Promise<StoreEntry> {
      await ensureTableExists()
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()

        const [rows] = await conn.query(
          `SELECT state, expires_at, created_at FROM ${escapedTable} WHERE \`key\` = ? FOR UPDATE`,
          [key],
        )

        const row = rows[0]
        let current: StoreEntry | null = null

        if (row) {
          const parsed = parseRow(row)
          if (parsed && parsed.expiresAt > Date.now()) {
            current = parsed
          }
        }

        const updated = updater(current)

        await conn.query(
          `INSERT INTO ${escapedTable} (\`key\`, state, expires_at, created_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE state = VALUES(state), expires_at = VALUES(expires_at)`,
          [key, JSON.stringify(updated.state), updated.expiresAt, updated.createdAt],
        )

        await conn.commit()
        return updated
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
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
      // Count first, then delete (compatible with our minimal MySqlPool interface)
      const [countRows] = await pool.query(
        `SELECT COUNT(*) as cnt FROM ${escapedTable} WHERE expires_at <= ?`,
        [now],
      )
      const count = Number(countRows[0]?.cnt ?? 0)
      await pool.query(`DELETE FROM ${escapedTable} WHERE expires_at <= ?`, [now])
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

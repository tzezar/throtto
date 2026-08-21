declare function setInterval(callback: () => void, ms: number): unknown
declare function clearInterval(handle: unknown): void

import type { Store, StoreEntry } from '../core/types.js'

// ─── SQLite Database Interface ───────────────────────────────────────────────
// Minimal interface compatible with better-sqlite3

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number }
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  transaction<T>(fn: () => T): () => T
  close(): void
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SqliteStoreConfig {
  /** better-sqlite3 Database instance (user provides) */
  db: SqliteDatabase
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
CREATE TABLE IF NOT EXISTS "${tableName}" (
  "key" TEXT PRIMARY KEY,
  "state" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_${tableName}_expires_at" ON "${tableName}" ("expires_at");
`.trim()
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Creates the rate limit table if it doesn't exist.
 * Call this during app startup or in migrations.
 */
export function ensureSqliteTable(
  db: SqliteDatabase,
  options?: { tableName?: string | undefined },
): void {
  const tableName = options?.tableName ?? 'throtto_rate_limits'
  const sql = getCreateTableSQL(tableName)
  db.exec(sql)
}

// ─── Store Implementation ────────────────────────────────────────────────────

/**
 * SQLite-backed store using better-sqlite3.
 *
 * Features:
 * - Synchronous transactions for true atomic operations (no race conditions)
 * - TEXT column for JSON state (SQLite doesn't have native JSON type)
 * - Perfect for single-server, embedded, or development use
 * - Index on expires_at for efficient cleanup
 * - Optional auto-table creation
 *
 * Note: better-sqlite3 is synchronous. All Store methods return resolved promises
 * to conform to the async Store interface.
 */
export function sqliteStore(config: SqliteStoreConfig): Store & { cleanup(): Promise<number> } {
  const {
    db,
    tableName = 'throtto_rate_limits',
    ensureTable: autoEnsure = false,
    cleanupInterval = 0,
  } = config

  let tableEnsured = !autoEnsure

  function ensureTableExists(): void {
    if (tableEnsured) return
    const sql = getCreateTableSQL(tableName)
    db.exec(sql)
    tableEnsured = true
  }

  function parseRow(row: Record<string, unknown>): StoreEntry | null {
    try {
      const state = JSON.parse(row.state as string) as Record<string, unknown>
      const expiresAt = Number(row.expires_at)
      const createdAt = Number(row.created_at)

      if (!state || Number.isNaN(expiresAt) || Number.isNaN(createdAt)) return null
      return { state, expiresAt, createdAt }
    } catch {
      return null
    }
  }

  // Prepare statements lazily (after table exists)
  let stmtGet: SqliteStatement | null = null
  let stmtUpsert: SqliteStatement | null = null
  let stmtDelete: SqliteStatement | null = null
  let stmtClear: SqliteStatement | null = null
  let stmtGetForUpdate: SqliteStatement | null = null

  function prepareStatements(): void {
    if (stmtGet) return
    stmtGet = db.prepare(
      `SELECT state, expires_at, created_at FROM "${tableName}" WHERE "key" = ? AND expires_at > ?`,
    )
    stmtUpsert = db.prepare(
      `INSERT INTO "${tableName}" ("key", state, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT("key") DO UPDATE SET state = excluded.state, expires_at = excluded.expires_at`,
    )
    stmtDelete = db.prepare(`DELETE FROM "${tableName}" WHERE "key" = ?`)
    stmtClear = db.prepare(`DELETE FROM "${tableName}"`)
    stmtGetForUpdate = db.prepare(
      `SELECT state, expires_at, created_at FROM "${tableName}" WHERE "key" = ?`,
    )
  }

  const store: Store & { cleanup(): Promise<number> } = {
    async get(key: string): Promise<StoreEntry | null> {
      ensureTableExists()
      prepareStatements()
      const row = stmtGet?.get(key, Date.now())
      if (!row) return null
      return parseRow(row)
    },

    async set(key: string, entry: StoreEntry, _ttlMs: number): Promise<void> {
      ensureTableExists()
      prepareStatements()
      stmtUpsert?.run(key, JSON.stringify(entry.state), entry.expiresAt, entry.createdAt)
    },

    async delete(key: string): Promise<void> {
      ensureTableExists()
      prepareStatements()
      stmtDelete?.run(key)
    },

    async clear(): Promise<void> {
      ensureTableExists()
      prepareStatements()
      stmtClear?.run()
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      _ttlMs: number,
    ): Promise<StoreEntry> {
      ensureTableExists()
      prepareStatements()

      // Use a transaction for true atomicity (SQLite serializes transactions)
      const doAtomic = db.transaction(() => {
        const row = stmtGetForUpdate?.get(key)
        let current: StoreEntry | null = null

        if (row) {
          const parsed = parseRow(row)
          if (parsed && parsed.expiresAt > Date.now()) {
            current = parsed
          }
        }

        const updated = updater(current)
        stmtUpsert?.run(key, JSON.stringify(updated.state), updated.expiresAt, updated.createdAt)
        return updated
      })

      return doAtomic()
    },

    async ping(): Promise<boolean> {
      try {
        db.prepare('SELECT 1').get()
        return true
      } catch {
        return false
      }
    },

    async cleanup(): Promise<number> {
      ensureTableExists()
      const stmt = db.prepare(`DELETE FROM "${tableName}" WHERE expires_at <= ?`)
      const result = stmt.run(Date.now())
      return result.changes
    },

    async shutdown(): Promise<void> {
      if (cleanupTimer !== null) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
      // Reset prepared statements
      stmtGet = null
      stmtUpsert = null
      stmtDelete = null
      stmtClear = null
      stmtGetForUpdate = null
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

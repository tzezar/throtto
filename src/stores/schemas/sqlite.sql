-- throtto: SQLite schema for rate limit store
-- Usage: sqlite3 your.db < sqlite.sql
-- Or use: npx throtto schema --store sqlite

CREATE TABLE IF NOT EXISTS "throtto_rate_limits" (
  "key" TEXT PRIMARY KEY,
  "state" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_throtto_rate_limits_expires_at"
  ON "throtto_rate_limits" ("expires_at");

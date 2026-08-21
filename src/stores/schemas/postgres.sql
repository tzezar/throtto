-- throtto: PostgreSQL schema for rate limit store
-- Usage: psql -d your_database -f postgres.sql
-- Or use: npx throtto schema --store postgres

CREATE TABLE IF NOT EXISTS "public"."throtto_rate_limits" (
  "key" VARCHAR(512) PRIMARY KEY,
  "state" JSONB NOT NULL,
  "expires_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_throtto_rate_limits_expires_at
  ON "public"."throtto_rate_limits" ("expires_at");

-- Optional: periodic cleanup of expired entries
-- Run via pg_cron or external scheduler:
-- DELETE FROM "public"."throtto_rate_limits" WHERE expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;

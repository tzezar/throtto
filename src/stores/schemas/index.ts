// ─── Schema Export ───────────────────────────────────────────────────────────

export type SqlStore = 'postgres' | 'mysql' | 'sqlite'

export interface SchemaOptions {
  /** Table name. Default: 'throtto_rate_limits' */
  tableName?: string | undefined
  /** Schema name (PostgreSQL only). Default: 'public' */
  schema?: string | undefined
}

/**
 * Returns raw SQL to create the rate limit table for the specified database.
 */
export function getSchema(store: SqlStore, options: SchemaOptions = {}): string {
  const tableName = options.tableName ?? 'throtto_rate_limits'
  const schema = options.schema ?? 'public'

  switch (store) {
    case 'postgres':
      return getPostgresSchema(tableName, schema)
    case 'mysql':
      return getMySqlSchema(tableName)
    case 'sqlite':
      return getSqliteSchema(tableName)
  }
}

function getPostgresSchema(tableName: string, schema: string): string {
  const qualifiedName = `"${schema}"."${tableName}"`
  return `CREATE TABLE IF NOT EXISTS ${qualifiedName} (
  "key" VARCHAR(512) PRIMARY KEY,
  "state" JSONB NOT NULL,
  "expires_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_${tableName}_expires_at"
  ON ${qualifiedName} ("expires_at");`
}

function getMySqlSchema(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
  \`key\` VARCHAR(512) NOT NULL PRIMARY KEY,
  \`state\` JSON NOT NULL,
  \`expires_at\` BIGINT NOT NULL,
  \`created_at\` BIGINT NOT NULL,
  INDEX idx_expires_at (\`expires_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
}

function getSqliteSchema(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (
  "key" TEXT PRIMARY KEY,
  "state" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_${tableName}_expires_at"
  ON "${tableName}" ("expires_at");`
}

/**
 * Returns a Drizzle ORM schema definition as a string.
 * Users can copy this into their Drizzle schema file.
 */
export function getDrizzleSchema(options: SchemaOptions = {}): string {
  const tableName = options.tableName ?? 'throtto_rate_limits'
  const schema = options.schema ?? 'public'

  return `import { pgTable, varchar, jsonb, bigint, index } from 'drizzle-orm/pg-core';

export const ${camelCase(tableName)} = pgTable('${tableName}', {
  key: varchar('key', { length: 512 }).primaryKey(),
  state: jsonb('state').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  expiresAtIdx: index('idx_${tableName}_expires_at').on(table.expiresAt),
}));`
}

/**
 * Returns a Prisma schema model definition as a string.
 * Users can copy this into their schema.prisma file.
 */
export function getPrismaSchema(options: SchemaOptions = {}): string {
  const tableName = options.tableName ?? 'throtto_rate_limits'

  return `model ${pascalCase(tableName)} {
  key       String @id @db.VarChar(512)
  state     Json
  expiresAt BigInt @map("expires_at")
  createdAt BigInt @map("created_at")

  @@index([expiresAt])
  @@map("${tableName}")
}`
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function camelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function pascalCase(str: string): string {
  const camel = camelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

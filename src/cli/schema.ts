import { getDrizzleSchema, getPrismaSchema, getSchema } from '../stores/schemas/index.js'
import type { SqlStore } from '../stores/schemas/index.js'

export interface SchemaCommandOptions {
  store: string
  format: string
  tableName: string
  schema: string
}

export function runSchemaCommand(options: SchemaCommandOptions): string {
  const { store, format, tableName, schema } = options

  if (format === 'drizzle') {
    return getDrizzleSchema({ tableName, schema })
  }

  if (format === 'prisma') {
    return getPrismaSchema({ tableName })
  }

  // SQL format
  const validStores: SqlStore[] = ['postgres', 'mysql', 'sqlite']
  if (!validStores.includes(store as SqlStore)) {
    return `Error: Unknown store "${store}". Valid options: ${validStores.join(', ')}`
  }

  return getSchema(store as SqlStore, { tableName, schema })
}

declare const process: {
  argv: string[]
  stdout: { write(s: string): boolean }
  stderr: { write(s: string): boolean }
  exit(code: number): never
}

import { runSchemaCommand } from './schema.js'

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string
  flags: Record<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2) // skip node + script
  const command = args[0] ?? 'help'
  const flags: Record<string, string> = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value && !value.startsWith('--')) {
        flags[key] = value
        i++
      } else {
        flags[key] = 'true'
      }
    }
  }

  return { command, flags }
}

// ─── Help ────────────────────────────────────────────────────────────────────

const HELP_TEXT = `
throtto CLI - Rate limiting utilities

Commands:
  schema    Generate database schema for SQL stores

Options for 'schema':
  --store <name>       Database: postgres, mysql, sqlite (default: postgres)
  --format <format>    Output: sql, drizzle, prisma (default: sql)
  --table <name>       Table name (default: throtto_rate_limits)
  --schema <name>      Schema name, PostgreSQL only (default: public)

Examples:
  npx throtto schema --store postgres
  npx throtto schema --store mysql --table my_limits
  npx throtto schema --format drizzle
  npx throtto schema --format prisma --table rate_limits

`.trim()

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const { command, flags } = parseArgs(process.argv)

  switch (command) {
    case 'schema': {
      const output = runSchemaCommand({
        store: flags.store ?? 'postgres',
        format: flags.format ?? 'sql',
        tableName: flags.table ?? 'throtto_rate_limits',
        schema: flags.schema ?? 'public',
      })
      process.stdout.write(`${output}\n`)
      break
    }

    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${HELP_TEXT}\n`)
      break

    default:
      process.stderr.write(`Unknown command: ${command}\n\n`)
      process.stdout.write(`${HELP_TEXT}\n`)
      process.exit(1)
  }
}

main()

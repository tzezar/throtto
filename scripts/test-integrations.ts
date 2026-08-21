#!/usr/bin/env node

/**
 * Run all integration tests against the LOCAL package build.
 *
 * Usage:
 *   pnpm test:integration              # build + link + run all
 *   pnpm test:integration --no-build   # skip build step (use existing dist/)
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const INTEGRATION_DIR = join(ROOT, 'integration-tests')
const NO_BUILD = process.argv.includes('--no-build')

const NODE_APPS = [
  'express-app',
  'fastify-app',
  'hono-app',
  'koa-app',
  'h3-app',
  'generic-http-app',
  'nextjs-app',
  'sveltekit-app',
  'remix-app',
  'astro-app',
  'nestjs-app',
  'lambda-app',
  'trpc-app',
  'websocket-app',
]

const BUN_APPS = ['bun-app', 'elysia-app']
const DENO_APPS = ['deno-app']

interface Result {
  app: string
  runtime: string
  passed: boolean
  duration: number
  error?: string
}

function hasRuntime(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function linkLocalPackage(app: string, runtime: 'node' | 'bun' | 'deno'): void {
  if (runtime === 'deno') return

  const dir = join(INTEGRATION_DIR, app)
  const nodeModules = join(dir, 'node_modules')
  const scopeDir = join(nodeModules, '@tzezar')
  const linkTarget = join(scopeDir, 'throtto')

  // Install other deps if no node_modules
  if (!existsSync(nodeModules)) {
    const cmd =
      runtime === 'bun' ? 'bun install --no-save' : 'pnpm install --ignore-scripts --no-lockfile'
    execSync(cmd, { cwd: dir, stdio: 'pipe', timeout: 60_000 })
  }

  // Replace the npm-installed package with a symlink to local
  if (existsSync(linkTarget)) {
    rmSync(linkTarget, { recursive: true })
  }
  mkdirSync(scopeDir, { recursive: true })
  symlinkSync(ROOT, linkTarget, 'dir')
}

function runTest(app: string, runtime: 'node' | 'bun' | 'deno'): Result {
  const dir = join(INTEGRATION_DIR, app)
  const start = Date.now()

  if (!existsSync(dir)) {
    return { app, runtime, passed: false, duration: 0, error: 'directory not found' }
  }

  try {
    linkLocalPackage(app, runtime)

    let cmd: string
    if (runtime === 'node') {
      cmd = 'node --import tsx/esm test.ts'
    } else if (runtime === 'bun') {
      cmd = 'bun run test.ts'
    } else {
      cmd = 'deno run --allow-net --allow-read --min-dep-age=0 test.ts'
    }

    execSync(cmd, { cwd: dir, stdio: 'pipe', timeout: 30_000 })
    return { app, runtime, passed: true, duration: Date.now() - start }
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
    const output = e.stdout?.toString() || e.stderr?.toString() || e.message || ''
    const lines = output.trim().split('\n')
    const snippet = lines.slice(-3).join('\n')
    return { app, runtime, passed: false, duration: Date.now() - start, error: snippet }
  }
}

// --- Main ---
console.log('╔══════════════════════════════════════════════╗')
console.log('║     throtto integration test runner          ║')
console.log('╚══════════════════════════════════════════════╝\n')

// Build
if (!NO_BUILD) {
  process.stdout.write('Building local package... ')
  try {
    execSync('pnpm build', { cwd: ROOT, stdio: 'pipe', timeout: 30_000 })
    console.log('✅')
  } catch (err: unknown) {
    console.log('❌')
    const e = err as { stderr?: Buffer; message?: string }
    console.error(e.stderr?.toString() || e.message)
    process.exit(1)
  }
} else {
  if (!existsSync(join(ROOT, 'dist'))) {
    console.error('❌ No dist/ found. Run pnpm build first or remove --no-build.')
    process.exit(1)
  }
  console.log('⚠ --no-build: using existing dist/\n')
}

const hasBun = hasRuntime('bun')
const hasDeno = hasRuntime('deno')

if (!hasBun) console.log('⚠ bun not found - skipping Bun apps')
if (!hasDeno) console.log('⚠ deno not found - skipping Deno apps')
console.log('')

const results: Result[] = []

// Node apps
console.log(`▶ Node.js apps (${NODE_APPS.length})`)
for (const app of NODE_APPS) {
  process.stdout.write(`  ${app}... `)
  const result = runTest(app, 'node')
  results.push(result)
  if (result.passed) {
    console.log(`✅ (${result.duration}ms)`)
  } else {
    console.log(`❌ (${result.duration}ms)`)
    if (result.error) console.log(`    ${result.error.split('\n').join('\n    ')}`)
  }
}

// Bun apps
if (hasBun) {
  console.log(`\n▶ Bun apps (${BUN_APPS.length})`)
  for (const app of BUN_APPS) {
    process.stdout.write(`  ${app}... `)
    const result = runTest(app, 'bun')
    results.push(result)
    if (result.passed) {
      console.log(`✅ (${result.duration}ms)`)
    } else {
      console.log(`❌ (${result.duration}ms)`)
      if (result.error) console.log(`    ${result.error.split('\n').join('\n    ')}`)
    }
  }
}

// Deno apps
if (hasDeno) {
  console.log(`\n▶ Deno apps (${DENO_APPS.length})`)
  for (const app of DENO_APPS) {
    process.stdout.write(`  ${app}... `)
    const result = runTest(app, 'deno')
    results.push(result)
    if (result.passed) {
      console.log(`✅ (${result.duration}ms)`)
    } else {
      console.log(`❌ (${result.duration}ms)`)
      if (result.error) console.log(`    ${result.error.split('\n').join('\n    ')}`)
    }
  }
}

// Summary
const passed = results.filter((r) => r.passed).length
const failed = results.filter((r) => !r.passed).length
const total = results.length
const totalTime = results.reduce((sum, r) => sum + r.duration, 0)

console.log(`\n${'─'.repeat(46)}`)
console.log(
  `Results: ${passed}/${total} passed, ${failed} failed (${(totalTime / 1000).toFixed(1)}s)`,
)

if (failed > 0) {
  console.log('\nFailed:')
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ✗ ${r.app} (${r.runtime})`)
  }
  process.exit(1)
}

console.log('\n✅ All integration tests passed!')

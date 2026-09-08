import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

const HARNESS = fileURLToPath(new URL('../fixtures/cluster-harness.ts', import.meta.url))

interface HarnessReport {
  isPrimary: boolean
  workers: number
  limit: number
  keyMode: string
  checks: number
  allowed: number
  denied: number
  degraded: boolean
  avgLatencyMs: number
}

async function runHarness(env: Record<string, string>): Promise<HarnessReport> {
  const { stdout } = await run(process.execPath, ['--import', 'tsx/esm', HARNESS], {
    env: { ...process.env, ...env },
    timeout: 60_000,
  })

  const line = stdout.trim().split('\n').at(-1)
  if (!line) throw new Error(`harness produced no output:\n${stdout}`)
  return JSON.parse(line) as HarnessReport
}

/**
 * End-to-end check against real `cluster.fork()` workers.
 *
 * Spawned as a child process because vitest itself runs tests inside worker
 * threads, where `cluster.fork()` is not available.
 */
describe('clusterStore: real cluster fork', () => {
  it('enforces a single shared limit across 4 forked workers', async () => {
    const report = await runHarness({
      THROTTO_WORKERS: '4',
      THROTTO_CHECKS: '50',
      THROTTO_LIMIT: '100',
    })

    expect(report.isPrimary).toBe(true)
    expect(report.degraded).toBe(false)
    expect(report.checks).toBe(200)
    // Without shared state this would be 4 x 100 = 400 allowed.
    expect(report.allowed).toBe(100)
    expect(report.denied).toBe(100)
  }, 90_000)

  it('holds a shared limit under concurrent in-flight checks', async () => {
    const report = await runHarness({
      THROTTO_WORKERS: '4',
      THROTTO_CHECKS: '50',
      THROTTO_LIMIT: '100',
      THROTTO_CONCURRENCY: '10',
    })

    expect(report.degraded).toBe(false)
    expect(report.allowed).toBe(100)
    expect(report.denied).toBe(100)
  }, 90_000)

  it('keeps IPC round-trip overhead low', async () => {
    const report = await runHarness({
      THROTTO_WORKERS: '2',
      THROTTO_CHECKS: '200',
      THROTTO_LIMIT: '1000',
      THROTTO_KEY_MODE: 'split',
    })

    expect(report.allowed).toBe(400)
    // Target is < 1ms per check; the assertion is loose so shared CI runners
    // don't produce false failures.
    expect(report.avgLatencyMs).toBeLessThan(5)
  }, 90_000)
})

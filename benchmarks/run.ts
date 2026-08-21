// throtto benchmarks
// Run: npx tsx benchmarks/run.ts
// Or:  node --import tsx benchmarks/run.ts

import { withAnalytics } from '../src/analytics/index.js'
import {
  concurrency,
  createCompoundLimiter,
  createLimiter,
  createTieredLimiter,
  fixedWindow,
  gcra,
  leakyBucket,
  memoryStore,
  parseDuration,
  pipe,
  rateLimit,
  slidingWindowCounter,
  slidingWindowLog,
  toErrorBody,
  toHeaders,
  tokenBucket,
  withAllowlist,
  withBatch,
  withDryRun,
  withOverride,
  withThresholds,
} from '../src/index.js'
import { createTestLimiter } from '../src/testing/index.js'

// ─── Benchmark Harness ───────────────────────────────────────────────────────

interface BenchResult {
  name: string
  ops: number
  opsPerSec: number
  avgNs: number
  minNs: number
  maxNs: number
  p50Ns: number
  p99Ns: number
  runs: number
}

async function bench(
  name: string,
  fn: () => void | Promise<void>,
  opts: { warmup?: number; duration?: number } = {},
): Promise<BenchResult> {
  const warmup = opts.warmup ?? 1000
  const duration = opts.duration ?? 2000

  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn()
  }

  // Collect samples
  const samples: number[] = []
  const start = performance.now()
  let ops = 0

  while (performance.now() - start < duration) {
    const t0 = performance.now()
    await fn()
    const t1 = performance.now()
    samples.push((t1 - t0) * 1_000_000) // ns
    ops++
  }

  const elapsed = performance.now() - start
  samples.sort((a, b) => a - b)

  return {
    name,
    ops,
    opsPerSec: Math.round((ops / elapsed) * 1000),
    avgNs: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    minNs: Math.round(samples[0]!),
    maxNs: Math.round(samples[samples.length - 1]!),
    p50Ns: Math.round(samples[Math.floor(samples.length * 0.5)]!),
    p99Ns: Math.round(samples[Math.floor(samples.length * 0.99)]!),
    runs: ops,
  }
}

function formatOps(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

function formatNs(ns: number): string {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)} μs`
  return `${ns} ns`
}

function printTable(results: BenchResult[]): void {
  const maxName = Math.max(...results.map((r) => r.name.length), 4)

  const header = [
    'Benchmark'.padEnd(maxName),
    'ops/sec'.padStart(10),
    'avg'.padStart(12),
    'p50'.padStart(12),
    'p99'.padStart(12),
    'min'.padStart(12),
    'max'.padStart(12),
  ].join(' │ ')

  const sep = header.replace(/[^│]/g, '─').replace(/│/g, '┼')

  console.log()
  console.log(header)
  console.log(sep)

  for (const r of results) {
    console.log(
      [
        r.name.padEnd(maxName),
        formatOps(r.opsPerSec).padStart(10),
        formatNs(r.avgNs).padStart(12),
        formatNs(r.p50Ns).padStart(12),
        formatNs(r.p99Ns).padStart(12),
        formatNs(r.minNs).padStart(12),
        formatNs(r.maxNs).padStart(12),
      ].join(' │ '),
    )
  }
  console.log()
}

function printMarkdownTable(results: BenchResult[]): void {
  console.log('| Benchmark | ops/sec | avg | p50 | p99 |')
  console.log('|---|---:|---:|---:|---:|')
  for (const r of results) {
    console.log(
      `| ${r.name} | ${formatOps(r.opsPerSec)} | ${formatNs(r.avgNs)} | ${formatNs(r.p50Ns)} | ${formatNs(r.p99Ns)} |`,
    )
  }
}

// ─── Benchmark Suites ────────────────────────────────────────────────────────

async function benchAlgorithms(): Promise<BenchResult[]> {
  console.log('\n═══ Algorithm Performance (memory store, single key) ═══')

  const algorithms = [
    {
      name: 'Fixed Window',
      config: { limit: 1000, window: '1m' as const, algorithm: 'fixed-window' as const },
    },
    {
      name: 'Sliding Window Counter',
      config: { limit: 1000, window: '1m' as const, algorithm: 'sliding-window-counter' as const },
    },
    {
      name: 'Sliding Window Log',
      config: { limit: 1000, window: '1m' as const, algorithm: 'sliding-window-log' as const },
    },
    {
      name: 'Token Bucket',
      config: { limit: 1000, window: '1m' as const, algorithm: 'token-bucket' as const },
    },
    {
      name: 'Leaky Bucket',
      config: { limit: 1000, window: '1m' as const, algorithm: 'leaky-bucket' as const },
    },
    { name: 'GCRA', config: { limit: 1000, window: '1m' as const, algorithm: 'gcra' as const } },
    {
      name: 'Concurrency',
      config: { limit: 1000, window: '30s' as const, algorithm: 'concurrency' as const },
    },
  ]

  const results: BenchResult[] = []

  for (const { name, config } of algorithms) {
    const limiter = rateLimit(config)
    let i = 0
    const result = await bench(name, async () => {
      await limiter.check(`user-${i++ % 100}`)
    })
    results.push(result)
    await limiter.shutdown()
  }

  printTable(results)
  return results
}

async function benchPresets(): Promise<BenchResult[]> {
  console.log('\n═══ Preset Creation + First Check ═══')

  const results: BenchResult[] = []

  // String preset
  results.push(
    await bench('rateLimit("100/minute")', async () => {
      const l = rateLimit('100/minute')
      await l.check('key')
      await l.shutdown()
    }),
  )

  // Object config
  results.push(
    await bench('rateLimit({ limit, window })', async () => {
      const l = rateLimit({ limit: 100, window: '1m' })
      await l.check('key')
      await l.shutdown()
    }),
  )

  // createLimiter (low-level)
  results.push(
    await bench('createLimiter() + check', async () => {
      const l = createLimiter({
        algorithm: slidingWindowCounter({ limit: 100, window: 60_000 }),
        store: memoryStore(),
      })
      await l.check('key')
      await l.shutdown()
    }),
  )

  printTable(results)
  return results
}

async function benchComposition(): Promise<BenchResult[]> {
  console.log('\n═══ Composition Overhead (per check) ═══')

  const results: BenchResult[] = []
  let i = 0

  // Baseline: bare limiter
  const bare = rateLimit({ limit: 100000, window: '1m' })
  i = 0
  results.push(
    await bench('Bare limiter', async () => {
      await bare.check(`user-${i++ % 100}`)
    }),
  )

  // + withAllowlist
  const allowlisted = pipe(
    rateLimit({ limit: 100000, window: '1m' }),
    withAllowlist({ allowlist: ['admin'] }),
  )
  i = 0
  results.push(
    await bench('+ withAllowlist', async () => {
      await allowlisted.check(`user-${i++ % 100}`)
    }),
  )

  // + withDryRun
  const dryRun = pipe(rateLimit({ limit: 100000, window: '1m' }), withDryRun())
  i = 0
  results.push(
    await bench('+ withDryRun', async () => {
      await dryRun.check(`user-${i++ % 100}`)
    }),
  )

  // + withOverride
  const overridden = withOverride(rateLimit({ limit: 100000, window: '1m' }))
  i = 0
  results.push(
    await bench('+ withOverride', async () => {
      await overridden.check(`user-${i++ % 100}`)
    }),
  )

  // + withThresholds
  const thresholded = pipe(
    rateLimit({ limit: 100000, window: '1m' }),
    withThresholds({
      thresholds: [
        { percent: 80, onThreshold: () => {} },
        { percent: 95, onThreshold: () => {} },
      ],
    }),
  )
  i = 0
  results.push(
    await bench('+ withThresholds', async () => {
      await thresholded.check(`user-${i++ % 100}`)
    }),
  )

  // + withAnalytics
  const analytics = withAnalytics(rateLimit({ limit: 100000, window: '1m' }))
  i = 0
  results.push(
    await bench('+ withAnalytics', async () => {
      await analytics.check(`user-${i++ % 100}`)
    }),
  )

  // Full stack: pipe 3 wrappers
  const fullStack = pipe(
    rateLimit({ limit: 100000, window: '1m' }),
    withAllowlist({ allowlist: ['admin'] }),
    withDryRun(),
    withOverride(),
  )
  i = 0
  results.push(
    await bench('pipe(3 wrappers)', async () => {
      await fullStack.check(`user-${i++ % 100}`)
    }),
  )

  // Cleanup
  for (const l of [bare, allowlisted, dryRun, overridden, thresholded, analytics, fullStack]) {
    await l.shutdown()
  }

  printTable(results)
  return results
}

async function benchAdvanced(): Promise<BenchResult[]> {
  console.log('\n═══ Advanced Limiter Performance ═══')

  const results: BenchResult[] = []
  let i = 0

  // Compound (3 layers)
  const compound = createCompoundLimiter([
    { name: 'burst', limiter: rateLimit({ limit: 100000, window: '1s' }) },
    { name: 'minute', limiter: rateLimit({ limit: 100000, window: '1m' }) },
    { name: 'hour', limiter: rateLimit({ limit: 100000, window: '1h' }) },
  ])
  i = 0
  results.push(
    await bench('Compound (3 layers)', async () => {
      await compound.check(`user-${i++ % 100}`)
    }),
  )

  // Tiered
  const tiered = createTieredLimiter<string>({
    tiers: [
      { name: 'free', algorithm: slidingWindowCounter({ limit: 100000, window: 60_000 }) },
      { name: 'pro', algorithm: slidingWindowCounter({ limit: 100000, window: 60_000 }) },
    ],
    resolveTier: (key) => (key.startsWith('pro') ? 'pro' : 'free'),
  })
  i = 0
  results.push(
    await bench('Tiered (2 tiers)', async () => {
      await tiered.check(`user-${i++ % 100}`)
    }),
  )

  // Cleanup
  await compound.shutdown()
  await tiered.shutdown()

  printTable(results)
  return results
}

async function benchHttpUtils(): Promise<BenchResult[]> {
  console.log('\n═══ HTTP Utilities ═══')

  const results: BenchResult[] = []

  // Create a sample result for header generation
  const limiter = rateLimit({ limit: 100, window: '1m' })
  const sampleResult = await limiter.check('bench-key')

  results.push(
    await bench('toHeaders(draft-7)', () => {
      toHeaders(sampleResult)
    }),
  )

  results.push(
    await bench('toHeaders(legacy)', () => {
      toHeaders(sampleResult, { format: 'legacy' })
    }),
  )

  results.push(
    await bench('toErrorBody(simple)', () => {
      toErrorBody(sampleResult)
    }),
  )

  results.push(
    await bench('toErrorBody(rfc7807)', () => {
      toErrorBody(sampleResult, { format: 'rfc7807' })
    }),
  )

  results.push(
    await bench('parseDuration("1m30s")', () => {
      parseDuration('1m30s')
    }),
  )

  await limiter.shutdown()
  printTable(results)
  return results
}

async function benchThroughput(): Promise<BenchResult[]> {
  console.log('\n═══ Throughput (sustained, 100 unique keys) ═══')

  const results: BenchResult[] = []
  const KEYS = 100

  // High-limit limiter to avoid denials affecting throughput
  const limiter = rateLimit({ limit: 1_000_000, window: '1m' })
  let i = 0
  results.push(
    await bench(
      `${KEYS} keys, check()`,
      async () => {
        await limiter.check(`key-${i++ % KEYS}`)
      },
      { duration: 3000 },
    ),
  )

  // Sequential burst: 10 checks per iteration
  const burstLimiter = rateLimit({ limit: 1_000_000, window: '1m' })
  let j = 0
  results.push(
    await bench(
      'Burst (10 checks/iter)',
      async () => {
        const key = `key-${j++ % KEYS}`
        for (let k = 0; k < 10; k++) {
          await burstLimiter.check(key)
        }
      },
      { duration: 3000 },
    ),
  )

  await limiter.shutdown()
  await burstLimiter.shutdown()

  printTable(results)
  return results
}

async function benchMemoryStore(): Promise<BenchResult[]> {
  console.log('\n═══ Memory Store Operations ═══')

  const results: BenchResult[] = []
  const store = memoryStore({ maxEntries: 100_000 })

  let i = 0
  results.push(
    await bench('store.get() (miss)', async () => {
      await store.get(`missing-${i++}`)
    }),
  )

  // Pre-populate
  for (let k = 0; k < 1000; k++) {
    await store.set(
      `key-${k}`,
      {
        state: { count: k },
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      60_000,
    )
  }

  i = 0
  results.push(
    await bench('store.get() (hit)', async () => {
      await store.get(`key-${i++ % 1000}`)
    }),
  )

  i = 0
  results.push(
    await bench('store.set()', async () => {
      await store.set(
        `set-${i++ % 1000}`,
        {
          state: { count: 1 },
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now(),
        },
        60_000,
      )
    }),
  )

  i = 0
  results.push(
    await bench('store.atomic()', async () => {
      await store.atomic?.(
        `atomic-${i++ % 1000}`,
        (current) => ({
          state: { count: ((current?.state?.count as number) ?? 0) + 1 },
          expiresAt: Date.now() + 60_000,
          createdAt: current?.createdAt ?? Date.now(),
        }),
        60_000,
      )
    }),
  )

  await store.shutdown?.()

  printTable(results)
  return results
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║           throtto Benchmark Suite v1.0.0            ║')
  console.log('║         Framework-agnostic rate limiting            ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log()
  console.log(
    `Platform: ${typeof process !== 'undefined' ? `Node.js ${process.version}` : 'Unknown'}`,
  )
  console.log(`Date: ${new Date().toISOString()}`)
  console.log(
    `CPU: ${typeof process !== 'undefined' ? ((await import('node:os')).cpus()[0]?.model ?? 'Unknown') : 'Unknown'}`,
  )

  const allResults: BenchResult[][] = []

  allResults.push(await benchAlgorithms())
  allResults.push(await benchComposition())
  allResults.push(await benchAdvanced())
  allResults.push(await benchHttpUtils())
  allResults.push(await benchThroughput())
  allResults.push(await benchMemoryStore())
  allResults.push(await benchPresets())

  // Print markdown summary
  console.log('\n═══ Markdown Summary (for README) ═══\n')

  const sections = [
    { title: 'Algorithms', results: allResults[0]! },
    { title: 'Composition Overhead', results: allResults[1]! },
    { title: 'Advanced Limiters', results: allResults[2]! },
    { title: 'HTTP Utilities', results: allResults[3]! },
    { title: 'Throughput', results: allResults[4]! },
    { title: 'Store Operations', results: allResults[5]! },
    { title: 'Creation', results: allResults[6]! },
  ]

  for (const { title, results } of sections) {
    console.log(`\n**${title}**\n`)
    printMarkdownTable(results)
  }
}

main().catch(console.error)

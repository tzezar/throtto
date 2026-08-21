import { concurrency } from '../algorithms/concurrency.js'
import { fixedWindow } from '../algorithms/fixed-window.js'
import { gcra } from '../algorithms/gcra.js'
import { leakyBucket } from '../algorithms/leaky-bucket.js'
import { slidingWindowCounter } from '../algorithms/sliding-window-counter.js'
import { slidingWindowLog } from '../algorithms/sliding-window-log.js'
import { tokenBucket } from '../algorithms/token-bucket.js'
import { parseDuration } from '../core/duration.js'
import { ConfigError } from '../core/errors.js'
import type {
  Algorithm,
  Clock,
  Limiter,
  LimiterConfig,
  LimiterHooks,
  Store,
} from '../core/types.js'
import type { Duration } from '../core/types.js'
import { memoryStore } from '../stores/memory.js'
import { createLimiter } from './create-limiter.js'

export interface PresetOptions {
  store?: Store | undefined
  clock?: Clock | undefined
  prefix?: string | undefined
  hooks?: LimiterHooks | undefined
  failMode?: 'open' | 'closed' | undefined
  fallbackStore?: Store | undefined
  normalizeKey?: 'lowercase' | 'trim' | 'lowercase-trim' | ((key: string) => string) | undefined
}

export interface SimpleConfig {
  limit: number
  window: Duration
  algorithm?:
    | 'sliding-window-counter'
    | 'fixed-window'
    | 'sliding-window-log'
    | 'token-bucket'
    | 'leaky-bucket'
    | 'gcra'
    | 'concurrency'
    | undefined
  store?: Store | undefined
  clock?: Clock | undefined
  prefix?: string | undefined
  hooks?: LimiterHooks | undefined
  failMode?: 'open' | 'closed' | undefined
  fallbackStore?: Store | undefined
  normalizeKey?: 'lowercase' | 'trim' | 'lowercase-trim' | ((key: string) => string) | undefined
}

const UNIT_MAP: Record<string, number> = {
  second: 1000,
  seconds: 1000,
  s: 1000,
  minute: 60000,
  minutes: 60000,
  min: 60000,
  m: 60000,
  hour: 3600000,
  hours: 3600000,
  h: 3600000,
  day: 86400000,
  days: 86400000,
  d: 86400000,
}

/**
 * Parse a preset string like '100/minute' or '1000/hour'.
 */
function parsePresetString(preset: string): { limit: number; windowMs: number } {
  const match = preset.match(/^(\d+)\s*\/\s*(\w+)$/)
  if (!match) {
    throw new ConfigError(
      `Invalid preset format: '${preset}'. Expected format like '100/minute', '1000/hour', '10/second'.`,
    )
  }

  const limit = Number.parseInt(match[1]!, 10)
  const unit = match[2]!.toLowerCase()
  const windowMs = UNIT_MAP[unit]

  if (!windowMs) {
    throw new ConfigError(
      `Invalid time unit: '${unit}'. Use: second, minute, hour, day (or s, m, h, d).`,
    )
  }

  if (limit <= 0) {
    throw new ConfigError(`Limit must be positive, got ${limit}.`)
  }

  return { limit, windowMs }
}

/**
 * Create a rate limiter with a simple preset.
 *
 * @example
 * ```ts
 * const limiter = rateLimit('100/minute')
 * const limiter = rateLimit('1000/hour', { store: redisStore() })
 * const limiter = rateLimit({ limit: 100, window: '1m' })
 * ```
 */
export function rateLimit(preset: string, options?: PresetOptions): Limiter
export function rateLimit(config: SimpleConfig): Limiter
export function rateLimit(presetOrConfig: string | SimpleConfig, options?: PresetOptions): Limiter {
  let limit: number
  let windowMs: number
  let opts: PresetOptions | undefined

  if (typeof presetOrConfig === 'string') {
    const parsed = parsePresetString(presetOrConfig)
    limit = parsed.limit
    windowMs = parsed.windowMs
    opts = options
  } else {
    limit = presetOrConfig.limit
    if (typeof limit !== 'number' || Number.isNaN(limit) || limit <= 0) {
      throw new ConfigError(`Invalid limit: ${limit}. Limit must be a positive number.`)
    }
    windowMs = parseDuration(presetOrConfig.window)
    opts = presetOrConfig
  }

  const algorithmName =
    typeof presetOrConfig === 'string'
      ? 'sliding-window-counter'
      : (presetOrConfig.algorithm ?? 'sliding-window-counter')

  // biome-ignore lint/suspicious/noExplicitAny: algorithm state varies by type
  let algorithm: Algorithm<any>
  switch (algorithmName) {
    case 'fixed-window':
      algorithm = fixedWindow({ limit, window: windowMs })
      break
    case 'sliding-window-log':
      algorithm = slidingWindowLog({ limit, window: windowMs })
      break
    case 'token-bucket':
      algorithm = tokenBucket({ capacity: limit, refillRate: limit, refillInterval: windowMs })
      break
    case 'leaky-bucket':
      algorithm = leakyBucket({ capacity: limit, leakRate: limit, leakInterval: windowMs })
      break
    case 'gcra':
      algorithm = gcra({ limit, period: windowMs })
      break
    case 'concurrency':
      algorithm = concurrency({ maxConcurrent: limit })
      break
    case 'sliding-window-counter':
      algorithm = slidingWindowCounter({ limit, window: windowMs })
      break
    default:
      throw new ConfigError(
        `Unknown algorithm: '${algorithmName}'. Valid options: sliding-window-counter, fixed-window, sliding-window-log, token-bucket, leaky-bucket, gcra, concurrency.`,
      )
  }

  const store = opts?.store ?? memoryStore()

  return createLimiter({
    algorithm,
    store,
    clock: opts?.clock,
    prefix: opts?.prefix,
    hooks: opts?.hooks,
    failMode: opts?.failMode,
    fallbackStore: opts?.fallbackStore,
    normalizeKey: opts?.normalizeKey,
  })
}

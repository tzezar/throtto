import { ConfigError } from '../core/errors.js'
import type {
  Algorithm,
  AllowedResult,
  CheckOptions,
  Clock,
  Limiter,
  RateLimitInfo,
  RateLimitResult,
  ShutdownOptions,
  Store,
} from '../core/types.js'
import { memoryStore } from '../stores/memory.js'
import { createLimiter } from './create-limiter.js'

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface ScheduleWhen {
  /** Hours range [start, end) in 24h format */
  hours?: [number, number] | undefined
  /** Days of week */
  days?: DayOfWeek[] | undefined
}

export interface ScheduleRule {
  name: string
  when: ScheduleWhen | 'default'
  // biome-ignore lint/suspicious/noExplicitAny: framework interop requires any
  algorithm: Algorithm<any>
}

export interface ScheduledConfig<TContext = string> {
  schedule: ScheduleRule[]
  store?: Store | undefined
  clock?: Clock | undefined
  prefix?: string | undefined
}

const DAY_MAP: Record<number, DayOfWeek> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
}

/**
 * Create a scheduled limiter with time-based rules.
 *
 * Different time periods can have different rate limits.
 * Rules are evaluated in order - first match wins.
 */
export function createScheduledLimiter<TContext = string>(
  config: ScheduledConfig<TContext>,
): Limiter<TContext> {
  if (!config.schedule || config.schedule.length === 0) {
    throw new ConfigError('createScheduledLimiter requires at least one schedule rule.')
  }

  const { schedule, store = memoryStore({ cleanupInterval: 0 }), clock, prefix = '' } = config

  // Create a limiter for each schedule rule
  const ruleLimiters = new Map<string, Limiter<string>>()
  for (const rule of schedule) {
    ruleLimiters.set(
      rule.name,
      createLimiter({
        algorithm: rule.algorithm,
        store,
        clock,
        prefix: `${prefix}sched:${rule.name}:`,
      }),
    )
  }

  function matchesWhen(when: ScheduleWhen, now: Date): boolean {
    if (when.hours) {
      const hour = now.getHours()
      const [start, end] = when.hours
      if (start <= end) {
        if (hour < start || hour >= end) return false
      } else {
        // Wraps around midnight (e.g. [22, 6])
        if (hour < start && hour >= end) return false
      }
    }

    if (when.days) {
      const day = DAY_MAP[now.getDay()]!
      if (!when.days.includes(day)) return false
    }

    return true
  }

  function resolveRule(now: number): ScheduleRule {
    const date = new Date(now)
    for (const rule of schedule) {
      if (rule.when === 'default') continue
      if (matchesWhen(rule.when, date)) return rule
    }
    // Fall through to default
    const defaultRule = schedule.find((r) => r.when === 'default')
    if (!defaultRule) return schedule[schedule.length - 1]!
    return defaultRule
  }

  function getLimiter(now: number): Limiter<string> {
    const rule = resolveRule(now)
    return ruleLimiters.get(rule.name)!
  }

  return {
    async check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult> {
      const now = clock?.now() ?? Date.now()
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      return getLimiter(now).check(key, options)
    },

    async consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult> {
      const now = clock?.now() ?? Date.now()
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      return getLimiter(now).consume(key, options)
    },

    async peek(ctx: TContext): Promise<RateLimitInfo | null> {
      const now = clock?.now() ?? Date.now()
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      return getLimiter(now).peek(key)
    },

    async reset(ctx: TContext): Promise<void> {
      const key = typeof ctx === 'string' ? ctx : String(ctx)
      await Promise.all([...ruleLimiters.values()].map((l) => l.reset(key)))
    },

    async shutdown(options?: ShutdownOptions): Promise<void> {
      await Promise.all([...ruleLimiters.values()].map((l) => l.shutdown(options)))
    },
  }
}

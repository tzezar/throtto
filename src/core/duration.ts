import { ConfigError } from './errors.js'
import type { Duration } from './types.js'

const UNIT_MAP: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/**
 * Parse a Duration value into milliseconds.
 *
 * Accepts:
 * - Numbers (treated as milliseconds)
 * - Strings like '100ms', '30s', '5m', '2h', '1d'
 * - Compound strings like '1m30s', '1h30m' (multiple units)
 *
 * @throws ConfigError on invalid input
 */
export function parseDuration(value: Duration): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new ConfigError(`Invalid duration: ${value}. Must be a non-negative finite number.`)
    }
    return value
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(
      `Invalid duration: ${String(value)}. Expected a number or duration string.`,
    )
  }

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g
  let total = 0
  let matched = false
  let lastIndex = 0

  let match: RegExpExecArray | null = pattern.exec(value)
  while (match !== null) {
    // Ensure no gaps between matches (no invalid characters between units)
    if (match.index !== lastIndex) {
      throw new ConfigError(
        `Invalid duration: '${value}'. Unexpected characters at position ${lastIndex}.`,
      )
    }

    const num = Number.parseFloat(match[1]!)
    const unit = match[2]!
    const multiplier = UNIT_MAP[unit]!

    total += num * multiplier
    matched = true
    lastIndex = pattern.lastIndex
    match = pattern.exec(value)
  }

  if (!matched || lastIndex !== value.length) {
    throw new ConfigError(
      `Invalid duration: '${value}'. Use format like '100ms', '30s', '5m', '2h', '1d' or compound '1m30s'.`,
    )
  }

  return Math.round(total)
}

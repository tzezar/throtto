import type { AggregatedMetrics } from './collector.js'

// ─── Prometheus ──────────────────────────────────────────────────────────────

export interface PrometheusOptions {
  /** Metric prefix. Default: 'throtto' */
  prefix?: string | undefined
  /** Additional labels */
  labels?: Record<string, string> | undefined
}

/**
 * Exports metrics in Prometheus text format.
 */
export function toPrometheus(metrics: AggregatedMetrics, options: PrometheusOptions = {}): string {
  const { prefix = 'throtto', labels = {} } = options
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')
  const labelSuffix = labelStr ? `{${labelStr}}` : ''

  const lines: string[] = []

  lines.push(`# HELP ${prefix}_requests_total Total rate limit checks`)
  lines.push(`# TYPE ${prefix}_requests_total counter`)
  lines.push(`${prefix}_requests_total${labelSuffix} ${metrics.totalRequests}`)

  lines.push(`# HELP ${prefix}_requests_allowed_total Allowed requests`)
  lines.push(`# TYPE ${prefix}_requests_allowed_total counter`)
  lines.push(`${prefix}_requests_allowed_total${labelSuffix} ${metrics.allowedRequests}`)

  lines.push(`# HELP ${prefix}_requests_denied_total Denied requests`)
  lines.push(`# TYPE ${prefix}_requests_denied_total counter`)
  lines.push(`${prefix}_requests_denied_total${labelSuffix} ${metrics.deniedRequests}`)

  lines.push(`# HELP ${prefix}_deny_rate Current deny rate`)
  lines.push(`# TYPE ${prefix}_deny_rate gauge`)
  lines.push(`${prefix}_deny_rate${labelSuffix} ${metrics.denyRate.toFixed(4)}`)

  lines.push(`# HELP ${prefix}_latency_avg_ms Average latency in ms`)
  lines.push(`# TYPE ${prefix}_latency_avg_ms gauge`)
  lines.push(`${prefix}_latency_avg_ms${labelSuffix} ${metrics.avgLatencyMs}`)

  lines.push(`# HELP ${prefix}_latency_p95_ms P95 latency in ms`)
  lines.push(`# TYPE ${prefix}_latency_p95_ms gauge`)
  lines.push(`${prefix}_latency_p95_ms${labelSuffix} ${metrics.p95LatencyMs}`)

  lines.push(`# HELP ${prefix}_latency_p99_ms P99 latency in ms`)
  lines.push(`# TYPE ${prefix}_latency_p99_ms gauge`)
  lines.push(`${prefix}_latency_p99_ms${labelSuffix} ${metrics.p99LatencyMs}`)

  return lines.join('\n')
}

// ─── JSON ────────────────────────────────────────────────────────────────────

/**
 * Exports metrics as a JSON string.
 */
export function toJSON(metrics: AggregatedMetrics): string {
  return JSON.stringify(metrics, null, 2)
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Exports metrics as a CSV row (with optional header).
 */
export function toCSV(metrics: AggregatedMetrics, includeHeader = false): string {
  const header =
    'timestamp,total,allowed,denied,deny_rate,avg_latency_ms,p95_latency_ms,p99_latency_ms'
  const row = [
    Date.now(),
    metrics.totalRequests,
    metrics.allowedRequests,
    metrics.deniedRequests,
    metrics.denyRate.toFixed(4),
    metrics.avgLatencyMs,
    metrics.p95LatencyMs,
    metrics.p99LatencyMs,
  ].join(',')

  return includeHeader ? `${header}\n${row}` : row
}

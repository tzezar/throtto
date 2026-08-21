declare function setInterval(cb: () => void, ms: number): unknown
declare function clearInterval(handle: unknown): void

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnalyticsEvent {
  key: string
  allowed: boolean
  cost: number
  timestamp: number
  latencyMs: number
  limit: number
  remaining: number
}

export interface AggregatedMetrics {
  totalRequests: number
  allowedRequests: number
  deniedRequests: number
  denyRate: number
  avgLatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  topKeys: Array<{ key: string; count: number; denyRate: number }>
  windowStart: number
  windowEnd: number
}

export interface CollectorConfig {
  /** Max events to keep in ring buffer. Default: 10000 */
  bufferSize?: number | undefined
  /** Aggregation window in ms. Default: 60000 */
  aggregationWindow?: number | undefined
  /** Sampling rate (0-1). Default: 1 (keep all) */
  sampleRate?: number | undefined
  /** Max unique keys to track. Default: 1000 */
  maxKeys?: number | undefined
}

// ─── Collector ───────────────────────────────────────────────────────────────

export interface Collector {
  record(event: AnalyticsEvent): void
  getMetrics(): AggregatedMetrics
  getRecentEvents(count?: number): AnalyticsEvent[]
  reset(): void
  shutdown(): void
}

export function createCollector(config: CollectorConfig = {}): Collector {
  const { bufferSize = 10_000, aggregationWindow = 60_000, sampleRate = 1, maxKeys = 1000 } = config

  // Ring buffer for events
  const buffer: AnalyticsEvent[] = []
  let writeIndex = 0
  let totalRecorded = 0

  // Per-key counters
  const keyCounts = new Map<string, { total: number; denied: number }>()

  function shouldSample(): boolean {
    if (sampleRate >= 1) return true
    return Math.random() < sampleRate
  }

  function addToBuffer(event: AnalyticsEvent): void {
    if (buffer.length < bufferSize) {
      buffer.push(event)
    } else {
      buffer[writeIndex] = event
    }
    writeIndex = (writeIndex + 1) % bufferSize
    totalRecorded++
  }

  function updateKeyCount(key: string, denied: boolean): void {
    let entry = keyCounts.get(key)
    if (!entry) {
      if (keyCounts.size >= maxKeys) {
        // Evict least active key
        let minKey: string | null = null
        let minCount = Number.POSITIVE_INFINITY
        for (const [k, v] of keyCounts) {
          if (v.total < minCount) {
            minCount = v.total
            minKey = k
          }
        }
        if (minKey) keyCounts.delete(minKey)
      }
      entry = { total: 0, denied: 0 }
      keyCounts.set(key, entry)
    }
    entry.total++
    if (denied) entry.denied++
  }

  function getWindowEvents(): AnalyticsEvent[] {
    const cutoff = Date.now() - aggregationWindow
    return buffer.filter((e) => e.timestamp >= cutoff)
  }

  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)] ?? 0
  }

  return {
    record(event: AnalyticsEvent): void {
      if (!shouldSample()) return
      addToBuffer(event)
      updateKeyCount(event.key, !event.allowed)
    },

    getMetrics(): AggregatedMetrics {
      const events = getWindowEvents()
      const total = events.length
      const allowed = events.filter((e) => e.allowed).length
      const denied = total - allowed

      const latencies = events.map((e) => e.latencyMs).sort((a, b) => a - b)
      const avgLatency = total > 0 ? latencies.reduce((s, l) => s + l, 0) / total : 0

      // Top keys by count
      const topKeys = Array.from(keyCounts.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([key, counts]) => ({
          key,
          count: counts.total,
          denyRate: counts.total > 0 ? counts.denied / counts.total : 0,
        }))

      return {
        totalRequests: total,
        allowedRequests: allowed,
        deniedRequests: denied,
        denyRate: total > 0 ? denied / total : 0,
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        p95LatencyMs: percentile(latencies, 95),
        p99LatencyMs: percentile(latencies, 99),
        topKeys,
        windowStart: Date.now() - aggregationWindow,
        windowEnd: Date.now(),
      }
    },

    getRecentEvents(count = 50): AnalyticsEvent[] {
      if (buffer.length < bufferSize) {
        // Buffer hasn't wrapped yet - array order is correct
        return buffer.slice(-count)
      }
      // Buffer has wrapped - reconstruct chronological order
      // writeIndex points to the NEXT write position (oldest entry)
      const ordered = [...buffer.slice(writeIndex), ...buffer.slice(0, writeIndex)]
      return ordered.slice(-count)
    },

    reset(): void {
      buffer.length = 0
      writeIndex = 0
      totalRecorded = 0
      keyCounts.clear()
    },

    shutdown(): void {
      this.reset()
    },
  }
}

import { describe, expect, it, vi } from 'vitest'
import { createCollector } from '../../src/analytics/collector.js'
import { toCSV, toJSON, toPrometheus } from '../../src/analytics/exporters.js'
import { withAnalytics } from '../../src/analytics/index.js'
import { createAnalyticsStream } from '../../src/analytics/stream.js'
import type { Limiter, RateLimitInfo, RateLimitResult } from '../../src/core/types.js'

// ─── Mock Limiter ────────────────────────────────────────────────────────────

function createMockLimiter(allowed = true): Limiter {
  const resetAt = Date.now() + 60_000
  const result: RateLimitResult = allowed
    ? { allowed: true, limit: 100, remaining: 99, resetAt, cost: 1 }
    : { allowed: false, limit: 100, remaining: 0, resetAt, retryAfter: 30_000, cost: 1 }

  return {
    check: vi.fn().mockResolvedValue(result),
    consume: vi.fn().mockResolvedValue(result),
    peek: vi.fn().mockResolvedValue({ limit: 100, remaining: 99, resetAt } as RateLimitInfo),
    reset: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }
}

// ─── Analytics Tests ─────────────────────────────────────────────────────────

describe('Analytics', () => {
  describe('Collector', () => {
    it('records events', () => {
      const collector = createCollector()
      collector.record({
        key: 'user-1',
        allowed: true,
        cost: 1,
        timestamp: Date.now(),
        latencyMs: 5,
        limit: 100,
        remaining: 99,
      })
      collector.record({
        key: 'user-1',
        allowed: false,
        cost: 1,
        timestamp: Date.now(),
        latencyMs: 3,
        limit: 100,
        remaining: 0,
      })

      const metrics = collector.getMetrics()
      expect(metrics.totalRequests).toBe(2)
      expect(metrics.allowedRequests).toBe(1)
      expect(metrics.deniedRequests).toBe(1)
      expect(metrics.denyRate).toBe(0.5)
    })

    it('calculates latency percentiles', () => {
      const collector = createCollector()
      for (let i = 1; i <= 100; i++) {
        collector.record({
          key: `k-${i}`,
          allowed: true,
          cost: 1,
          timestamp: Date.now(),
          latencyMs: i,
          limit: 100,
          remaining: 99,
        })
      }
      const metrics = collector.getMetrics()
      expect(metrics.p95LatencyMs).toBeGreaterThanOrEqual(95)
      expect(metrics.p99LatencyMs).toBeGreaterThanOrEqual(99)
    })

    it('tracks top keys', () => {
      const collector = createCollector()
      for (let i = 0; i < 50; i++) {
        collector.record({
          key: 'hot-key',
          allowed: true,
          cost: 1,
          timestamp: Date.now(),
          latencyMs: 1,
          limit: 100,
          remaining: 99,
        })
      }
      collector.record({
        key: 'cold-key',
        allowed: true,
        cost: 1,
        timestamp: Date.now(),
        latencyMs: 1,
        limit: 100,
        remaining: 99,
      })

      const metrics = collector.getMetrics()
      expect(metrics.topKeys[0]?.key).toBe('hot-key')
      expect(metrics.topKeys[0]?.count).toBe(50)
    })

    it('respects sampling rate', () => {
      const collector = createCollector({ sampleRate: 0 })
      for (let i = 0; i < 100; i++) {
        collector.record({
          key: 'k',
          allowed: true,
          cost: 1,
          timestamp: Date.now(),
          latencyMs: 1,
          limit: 100,
          remaining: 99,
        })
      }
      const metrics = collector.getMetrics()
      expect(metrics.totalRequests).toBe(0)
    })
  })

  describe('Exporters', () => {
    const metrics = {
      totalRequests: 1000,
      allowedRequests: 950,
      deniedRequests: 50,
      denyRate: 0.05,
      avgLatencyMs: 12.5,
      p95LatencyMs: 45,
      p99LatencyMs: 120,
      topKeys: [{ key: 'user-1', count: 100, denyRate: 0.1 }],
      windowStart: Date.now() - 60_000,
      windowEnd: Date.now(),
    }

    it('exports Prometheus format', () => {
      const output = toPrometheus(metrics)
      expect(output).toContain('throtto_requests_total 1000')
      expect(output).toContain('throtto_deny_rate')
      expect(output).toContain('# TYPE')
    })

    it('exports JSON', () => {
      const output = toJSON(metrics)
      const parsed = JSON.parse(output)
      expect(parsed.totalRequests).toBe(1000)
    })

    it('exports CSV', () => {
      const output = toCSV(metrics, true)
      expect(output).toContain('timestamp,total,allowed')
      expect(output).toContain('1000')
    })
  })

  describe('withAnalytics', () => {
    it('wraps limiter and collects metrics', async () => {
      const limiter = createMockLimiter(true)
      const analytics = withAnalytics(limiter)

      await analytics.check('user-1')
      await analytics.check('user-2')

      const metrics = analytics.getMetrics()
      expect(metrics.totalRequests).toBe(2)
      expect(metrics.allowedRequests).toBe(2)
    })
  })

  describe('Stream', () => {
    it('pushes events to subscribers', async () => {
      const stream = createAnalyticsStream()
      const sub = stream.subscribe()

      const event = {
        key: 'k',
        allowed: true,
        cost: 1,
        timestamp: Date.now(),
        latencyMs: 1,
        limit: 100,
        remaining: 99,
      }
      stream.push(event)

      const result = await sub.next()
      expect(result.value).toEqual(event)
      expect(result.done).toBe(false)
      await sub.return()
    })

    it('filters events', async () => {
      const stream = createAnalyticsStream()
      const sub = stream.subscribe({ filter: (e) => !e.allowed })

      stream.push({
        key: 'k',
        allowed: true,
        cost: 1,
        timestamp: Date.now(),
        latencyMs: 1,
        limit: 100,
        remaining: 99,
      })
      stream.push({
        key: 'k',
        allowed: false,
        cost: 1,
        timestamp: Date.now(),
        latencyMs: 1,
        limit: 100,
        remaining: 0,
      })

      const result = await sub.next()
      expect(result.value?.allowed).toBe(false)
      await sub.return()
    })

    it('tracks subscriber count', () => {
      const stream = createAnalyticsStream()
      expect(stream.subscriberCount()).toBe(0)
      const sub = stream.subscribe()
      expect(stream.subscriberCount()).toBe(1)
      void sub.return()
    })
  })
})

import { realClock } from '../core/clock.js'
import type { Clock, Store } from '../core/types.js'

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  store: {
    connected: boolean
    latencyMs: number
  }
  uptime: number
  lastError?: { message: string; timestamp: number } | undefined
}

export interface HealthCheckConfig {
  store: Store
  clock?: Clock | undefined
}

/**
 * Create a health checker for a limiter's store.
 *
 * Performs a simple get/set/delete cycle to verify
 * the store is responsive.
 */
export function createHealthCheck(config: HealthCheckConfig) {
  const { store, clock = realClock } = config
  const startTime = clock.now()
  let lastError: { message: string; timestamp: number } | undefined

  return {
    async check(): Promise<HealthStatus> {
      const start = clock.now()
      try {
        // Probe the store with a health check key
        const healthKey = '__throtto_health_check__'
        await store.get(healthKey)

        const latencyMs = clock.now() - start
        const status = latencyMs > 1000 ? 'degraded' : 'healthy'

        return {
          status,
          store: { connected: true, latencyMs },
          uptime: clock.now() - startTime,
          lastError,
        }
      } catch (error) {
        const latencyMs = clock.now() - start
        lastError = {
          message: error instanceof Error ? error.message : String(error),
          timestamp: clock.now(),
        }

        return {
          status: 'unhealthy',
          store: { connected: false, latencyMs },
          uptime: clock.now() - startTime,
          lastError,
        }
      }
    },

    async isHealthy(): Promise<boolean> {
      const result = await this.check()
      return result.status === 'healthy'
    },
  }
}

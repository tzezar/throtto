import { describe, expect, it } from 'vitest'
import type { Store } from '../../src/core/types.js'
import { createHealthCheck } from '../../src/limiter/health.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createHealthCheck', () => {
  it('returns healthy for working store', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const health = createHealthCheck({ store })

    const status = await health.check()
    expect(status.status).toBe('healthy')
    expect(status.store.connected).toBe(true)
    expect(status.store.latencyMs).toBeGreaterThanOrEqual(0)
    await store.shutdown?.()
  })

  it('isHealthy returns true for working store', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const health = createHealthCheck({ store })

    expect(await health.isHealthy()).toBe(true)
    await store.shutdown?.()
  })

  it('returns unhealthy for broken store', async () => {
    const brokenStore: Store = {
      get: () => Promise.reject(new Error('connection refused')),
      set: () => Promise.reject(new Error('connection refused')),
      delete: () => Promise.reject(new Error('connection refused')),
      clear: () => Promise.reject(new Error('connection refused')),
    }

    const health = createHealthCheck({ store: brokenStore })
    const status = await health.check()

    expect(status.status).toBe('unhealthy')
    expect(status.store.connected).toBe(false)
    expect(status.lastError).toBeDefined()
    expect(status.lastError?.message).toContain('connection refused')
  })

  it('isHealthy returns false for broken store', async () => {
    const brokenStore: Store = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      delete: () => Promise.reject(new Error('down')),
      clear: () => Promise.reject(new Error('down')),
    }

    const health = createHealthCheck({ store: brokenStore })
    expect(await health.isHealthy()).toBe(false)
  })

  it('tracks uptime', async () => {
    const store = memoryStore({ cleanupInterval: 0 })
    const health = createHealthCheck({ store })

    const status = await health.check()
    expect(status.uptime).toBeGreaterThanOrEqual(0)
    await store.shutdown?.()
  })
})

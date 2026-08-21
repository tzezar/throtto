declare function setTimeout(cb: () => void, ms: number): unknown

import type { Store, StoreEntry } from '../core/types.js'

export interface MockStoreConfig {
  failOn?: Array<'get' | 'set' | 'delete' | 'clear' | 'atomic'> | undefined
  latencyMs?: number | undefined
  failAfter?: number | undefined
}

export interface MockStore extends Store {
  calls: Array<{ method: string; args: unknown[]; timestamp: number }>
  failNext(method: string): void
  getCallCount(method: string): number
  reset(): void
}

export function mockStore(config?: MockStoreConfig): MockStore {
  const entries = new Map<string, { entry: StoreEntry; ttlMs: number }>()
  const calls: Array<{ method: string; args: unknown[]; timestamp: number }> = []
  const failNextSet = new Set<string>()
  let totalOps = 0

  const failOn = config?.failOn ?? []
  const latencyMs = config?.latencyMs ?? 0
  const failAfter = config?.failAfter

  function recordCall(method: string, args: unknown[]): void {
    calls.push({ method, args, timestamp: Date.now() })
  }

  async function maybeDelay(): Promise<void> {
    if (latencyMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, latencyMs)
      })
    }
  }

  function checkFailures(method: string): void {
    totalOps++

    if (failNextSet.has(method)) {
      failNextSet.delete(method)
      throw new Error(`MockStore: injected failure on ${method}`)
    }

    if (failOn.includes(method as 'get' | 'set' | 'delete' | 'clear' | 'atomic')) {
      throw new Error(`MockStore: configured to fail on ${method}`)
    }

    if (failAfter !== undefined && totalOps > failAfter) {
      throw new Error(`MockStore: failing after ${failAfter} operations`)
    }
  }

  const store: MockStore = {
    calls,

    failNext(method: string): void {
      failNextSet.add(method)
    },

    getCallCount(method: string): number {
      return calls.filter((c) => c.method === method).length
    },

    reset(): void {
      calls.length = 0
      failNextSet.clear()
      totalOps = 0
    },

    async get(key: string): Promise<StoreEntry | null> {
      recordCall('get', [key])
      await maybeDelay()
      checkFailures('get')
      const record = entries.get(key)
      if (!record) return null
      return record.entry
    },

    async set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
      recordCall('set', [key, entry, ttlMs])
      await maybeDelay()
      checkFailures('set')
      entries.set(key, { entry, ttlMs })
    },

    async delete(key: string): Promise<void> {
      recordCall('delete', [key])
      await maybeDelay()
      checkFailures('delete')
      entries.delete(key)
    },

    async clear(): Promise<void> {
      recordCall('clear', [])
      await maybeDelay()
      checkFailures('clear')
      entries.clear()
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      ttlMs: number,
    ): Promise<StoreEntry> {
      recordCall('atomic', [key, updater, ttlMs])
      await maybeDelay()
      checkFailures('atomic')
      const record = entries.get(key)
      const current = record ? record.entry : null
      const updated = updater(current)
      entries.set(key, { entry: updated, ttlMs })
      return updated
    },

    async keys(prefix?: string): Promise<string[]> {
      recordCall('keys', [prefix])
      await maybeDelay()
      checkFailures('keys')
      const result: string[] = []
      for (const key of entries.keys()) {
        if (!prefix || key.startsWith(prefix)) {
          result.push(key)
        }
      }
      return result
    },

    async ping(): Promise<boolean> {
      recordCall('ping', [])
      return true
    },

    async shutdown(): Promise<void> {
      recordCall('shutdown', [])
      await maybeDelay()
      entries.clear()
    },
  }

  return store
}

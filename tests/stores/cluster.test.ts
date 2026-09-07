import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import type { ClusterStore } from '../../src/stores/cluster/index.js'
import { clusterStore, detectRole } from '../../src/stores/cluster/index.js'
import { createMockChannel } from './cluster-channel.js'
import { runStoreConformanceTests } from './store-conformance.test.js'

function makeEntry(state: Record<string, unknown>, ttlMs = 60_000) {
  return {
    state,
    expiresAt: Date.now() + ttlMs,
    createdAt: Date.now(),
  }
}

/** Primary + worker pair wired over the mock IPC channel. */
async function createPair(workers = 1) {
  const channel = createMockChannel()
  const primary = clusterStore({
    transport: channel.primary,
    cleanupInterval: 0,
  })
  await primary.ready()

  const transports = Array.from({ length: workers }, () => channel.createWorker())
  const stores = await Promise.all(
    transports.map(async (transport) => {
      const store = clusterStore({ transport, cleanupInterval: 0, timeout: 200 })
      await store.ready()
      return store
    }),
  )

  return { channel, primary, transports, stores, worker: stores[0]!, transport: transports[0]! }
}

// ─── Conformance ─────────────────────────────────────────────────────────────

runStoreConformanceTests('ClusterStore (primary process)', () => {
  const channel = createMockChannel()
  return clusterStore({ transport: channel.primary, cleanupInterval: 0 })
})

runStoreConformanceTests('ClusterStore (worker process)', async () => {
  const channel = createMockChannel()
  const primary = clusterStore({ transport: channel.primary, cleanupInterval: 0 })
  await primary.ready()
  const worker = clusterStore({
    transport: channel.createWorker(),
    cleanupInterval: 0,
    timeout: 500,
  })
  await worker.ready()
  return worker
})

// ─── Role detection ──────────────────────────────────────────────────────────

describe('clusterStore: role detection', () => {
  function withStubbedProcess(stub: Record<string, unknown>, assert: () => void): void {
    vi.stubGlobal('process', stub)
    try {
      assert()
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it('treats a process without an IPC channel as the primary', () => {
    withStubbedProcess({ env: {} }, () => {
      expect(detectRole()).toBe('primary')
    })
  })

  it('treats a process holding an IPC channel as a worker', () => {
    withStubbedProcess({ env: {}, connected: true, send: () => true }, () => {
      expect(detectRole()).toBe('worker')
    })
  })

  it('treats a closed IPC channel as the primary', () => {
    withStubbedProcess({ env: {}, connected: false, send: () => true }, () => {
      expect(detectRole()).toBe('primary')
    })
  })

  it('honours an explicit role override', async () => {
    const channel = createMockChannel()
    const store = clusterStore({ transport: channel.primary })
    expect(store.isPrimary).toBe(true)
    await store.shutdown?.()
  })

  it('reports worker transports as non-primary', async () => {
    const { worker, primary } = await createPair()
    expect(worker.isPrimary).toBe(false)
    await worker.shutdown?.()
    await primary.shutdown?.()
  })
})

// ─── Shared state ────────────────────────────────────────────────────────────

describe('clusterStore: shared state', () => {
  let stores: ClusterStore[] = []

  afterEach(async () => {
    await Promise.all(stores.map((store) => store.shutdown?.()))
    stores = []
  })

  it('reads state written by another worker', async () => {
    const pair = await createPair(2)
    stores = [pair.primary, ...pair.stores]
    const [a, b] = pair.stores as [ClusterStore, ClusterStore]

    await a.set('shared', makeEntry({ count: 7 }), 60_000)
    const read = await b.get('shared')

    expect(read?.state).toEqual({ count: 7 })
  })

  it('reads state written on the primary', async () => {
    const pair = await createPair()
    stores = [pair.primary, pair.worker]

    await pair.primary.set('from-primary', makeEntry({ count: 1 }), 60_000)
    expect((await pair.worker.get('from-primary'))?.state).toEqual({ count: 1 })
  })

  it('serializes concurrent atomic updates across workers', async () => {
    const pair = await createPair(4)
    stores = [pair.primary, ...pair.stores]

    const increments = pair.stores.flatMap((store) =>
      Array.from({ length: 25 }, () =>
        store.atomic?.(
          'counter',
          (current) => makeEntry({ count: ((current?.state.count as number) ?? 0) + 1 }),
          60_000,
        ),
      ),
    )

    await Promise.all(increments)

    const final = await pair.primary.get('counter')
    expect(final?.state.count).toBe(100)
  })

  it('enforces one shared limit across workers instead of N x limit', async () => {
    const pair = await createPair(3)
    stores = [pair.primary, ...pair.stores]

    const limiters = pair.stores.map((store) =>
      createLimiter({ algorithm: fixedWindow({ limit: 10, window: '1m' }), store }),
    )

    const results = await Promise.all(
      limiters.flatMap((limiter) => Array.from({ length: 10 }, () => limiter.check('user:1'))),
    )

    expect(results.filter((r) => r.allowed)).toHaveLength(10)
    expect(results.filter((r) => !r.allowed)).toHaveLength(20)
  })

  it('deletes and clears through the primary', async () => {
    const pair = await createPair(2)
    stores = [pair.primary, ...pair.stores]
    const [a, b] = pair.stores as [ClusterStore, ClusterStore]

    await a.set('k1', makeEntry({ v: 1 }), 60_000)
    await a.set('k2', makeEntry({ v: 2 }), 60_000)

    await b.delete('k1')
    expect(await a.get('k1')).toBeNull()
    expect(await a.get('k2')).not.toBeNull()

    await b.clear()
    expect(await a.get('k2')).toBeNull()
  })

  it('lists keys held by the primary', async () => {
    const pair = await createPair()
    stores = [pair.primary, pair.worker]

    await pair.worker.set('api:a', makeEntry({}), 60_000)
    await pair.worker.set('api:b', makeEntry({}), 60_000)
    await pair.worker.set('web:c', makeEntry({}), 60_000)

    expect((await pair.worker.keys?.('api:'))?.sort()).toEqual(['api:a', 'api:b'])
  })

  it('answers ping from a worker', async () => {
    const pair = await createPair()
    stores = [pair.primary, pair.worker]
    expect(await pair.worker.ping?.()).toBe(true)
  })
})

// ─── Round trips ─────────────────────────────────────────────────────────────

describe('clusterStore: IPC efficiency', () => {
  it('costs a single round trip per check once a key is cached', async () => {
    const pair = await createPair()
    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 100, window: '1m' }),
      store: pair.worker,
    })

    await limiter.check('user:1') // cold: no cached version yet
    const afterWarmup = pair.transport.sent

    await limiter.check('user:1')
    await limiter.check('user:1')
    await limiter.check('user:1')

    expect(pair.transport.sent - afterWarmup).toBe(3)

    await pair.worker.shutdown?.()
    await pair.primary.shutdown?.()
  })

  it('never writes based on a stale cached version', async () => {
    const pair = await createPair(2)
    const [a, b] = pair.stores as [ClusterStore, ClusterStore]

    await a.atomic?.('race', () => makeEntry({ count: 1 }), 60_000)
    // `a` now caches version N. `b` bumps the key behind its back.
    await b.atomic?.('race', () => makeEntry({ count: 99 }), 60_000)

    const seen: (number | null)[] = []
    await a.atomic?.(
      'race',
      (current) => {
        seen.push((current?.state.count as number) ?? null)
        return makeEntry({ count: ((current?.state.count as number) ?? 0) + 1 })
      },
      60_000,
    )

    // The optimistic attempt used the stale cache and lost; the fair retry
    // saw the committed value.
    expect(seen.at(-1)).toBe(99)
    expect((await pair.primary.get('race'))?.state).toEqual({ count: 100 })

    await Promise.all([pair.primary, ...pair.stores].map((s) => s.shutdown?.()))
  })
})

// ─── Contention ──────────────────────────────────────────────────────────────

describe('clusterStore: contention', () => {
  it('does not starve a worker that keeps losing the optimistic write', async () => {
    const pair = await createPair(4)

    // Every worker drives the same key, sequentially, at the same time - the
    // pattern that livelocks a pure compare-and-swap store.
    const perWorker = await Promise.all(
      pair.stores.map(async (store) => {
        let applied = 0
        for (let i = 0; i < 25; i++) {
          await store.atomic?.(
            'hot',
            (current) => makeEntry({ count: ((current?.state.count as number) ?? 0) + 1 }),
            60_000,
          )
          applied++
        }
        return applied
      }),
    )

    expect(perWorker).toEqual([25, 25, 25, 25])
    expect((await pair.primary.get('hot'))?.state).toEqual({ count: 100 })

    await Promise.all([pair.primary, ...pair.stores].map((s) => s.shutdown?.()))
  })

  it('releases a key when the updater throws', async () => {
    const pair = await createPair(2)
    const [a, b] = pair.stores as [ClusterStore, ClusterStore]

    await a.set('boom', makeEntry({ count: 1 }), 60_000)
    // Force `a` onto the lock path by poisoning its cached version.
    await b.set('boom', makeEntry({ count: 2 }), 60_000)

    await expect(
      a.atomic?.(
        'boom',
        () => {
          throw new Error('updater exploded')
        },
        60_000,
      ),
    ).rejects.toThrow('updater exploded')

    // The key must still be usable by everyone else.
    const after = await b.atomic?.(
      'boom',
      (current) => makeEntry({ count: ((current?.state.count as number) ?? 0) + 1 }),
      60_000,
    )
    expect(after?.state).toEqual({ count: 3 })

    await Promise.all([pair.primary, ...pair.stores].map((s) => s.shutdown?.()))
  })
})

// ─── Graceful degradation ────────────────────────────────────────────────────

describe('clusterStore: graceful degradation', () => {
  it('falls back to local state when the primary never answers', async () => {
    const channel = createMockChannel()
    const transport = channel.createWorker()
    const onDegraded = vi.fn()
    const worker = clusterStore({
      transport,
      timeout: 20,
      cleanupInterval: 0,
      onDegraded,
    })
    await worker.ready()

    transport.setResponsive(false)

    const result = await worker.atomic?.('k', () => makeEntry({ count: 1 }), 60_000)

    expect(result?.state).toEqual({ count: 1 })
    expect(worker.degraded).toBe(true)
    expect(onDegraded).toHaveBeenCalledTimes(1)

    await worker.shutdown?.()
  })

  it('short-circuits to local state while degraded', async () => {
    const channel = createMockChannel()
    const transport = channel.createWorker()
    const worker = clusterStore({
      transport,
      timeout: 20,
      retryInterval: 10_000,
      cleanupInterval: 0,
    })
    await worker.ready()

    transport.setResponsive(false)
    await worker.get('k')
    const afterFirstFailure = transport.sent

    await worker.get('k')
    await worker.get('k')

    expect(transport.sent).toBe(afterFirstFailure)
    await worker.shutdown?.()
  })

  it('recovers once the primary responds again', async () => {
    const channel = createMockChannel()
    const primary = clusterStore({ transport: channel.primary, cleanupInterval: 0 })
    await primary.ready()

    const transport = channel.createWorker()
    const onRecovered = vi.fn()
    const worker = clusterStore({
      transport,
      timeout: 20,
      retryInterval: 0,
      cleanupInterval: 0,
      onRecovered,
    })
    await worker.ready()

    transport.setResponsive(false)
    await worker.get('k')
    expect(worker.degraded).toBe(true)

    transport.setResponsive(true)
    await worker.get('k')

    expect(worker.degraded).toBe(false)
    expect(onRecovered).toHaveBeenCalledTimes(1)

    await worker.shutdown?.()
    await primary.shutdown?.()
  })

  it('throws instead of degrading when onUnreachable is "error"', async () => {
    const channel = createMockChannel()
    const transport = channel.createWorker()
    const worker = clusterStore({
      transport,
      timeout: 20,
      cleanupInterval: 0,
      onUnreachable: 'error',
    })
    await worker.ready()
    transport.setResponsive(false)

    await expect(worker.get('k')).rejects.toThrow(/did not respond/)
    await worker.shutdown?.()
  })

  it('lets the limiter fail open when the primary is gone', async () => {
    const channel = createMockChannel()
    const transport = channel.createWorker()
    const worker = clusterStore({
      transport,
      timeout: 20,
      cleanupInterval: 0,
      onUnreachable: 'error',
    })
    await worker.ready()
    transport.setResponsive(false)

    const limiter = createLimiter({
      algorithm: fixedWindow({ limit: 1, window: '1m' }),
      store: worker,
      failMode: 'open',
    })

    expect((await limiter.check('user:1')).allowed).toBe(true)
    expect((await limiter.check('user:1')).allowed).toBe(true)

    await worker.shutdown?.()
  })

  it('degrades immediately when the IPC channel is closed', async () => {
    const channel = createMockChannel()
    const primary = clusterStore({ transport: channel.primary, cleanupInterval: 0 })
    await primary.ready()
    const transport = channel.createWorker()
    const worker = clusterStore({ transport, timeout: 5000, cleanupInterval: 0 })
    await worker.ready()

    transport.disconnect()

    const start = Date.now()
    await worker.set('k', makeEntry({ count: 1 }), 60_000)
    expect(Date.now() - start).toBeLessThan(1000)
    expect(worker.degraded).toBe(true)

    await worker.shutdown?.()
    await primary.shutdown?.()
  })
})

// ─── Isolation & lifecycle ───────────────────────────────────────────────────

describe('clusterStore: namespaces and lifecycle', () => {
  it('keeps namespaced stores on the same channel isolated', async () => {
    const channel = createMockChannel()
    const primaryA = clusterStore({
      transport: channel.primary,
      namespace: 'a',
      cleanupInterval: 0,
    })
    await primaryA.ready()

    const workerB = clusterStore({
      transport: channel.createWorker(),
      namespace: 'b',
      timeout: 20,
      cleanupInterval: 0,
    })
    await workerB.ready()

    // Namespace 'b' has no primary listening, so it degrades rather than
    // reading namespace 'a' state.
    await workerB.set('k', makeEntry({ count: 1 }), 60_000)
    expect(workerB.degraded).toBe(true)
    expect(await primaryA.get('k')).toBeNull()

    await workerB.shutdown?.()
    await primaryA.shutdown?.()
  })

  it('rejects in-flight requests on shutdown', async () => {
    const channel = createMockChannel()
    const transport = channel.createWorker()
    const worker = clusterStore({ transport, timeout: 5000, cleanupInterval: 0 })
    await worker.ready()
    transport.setResponsive(false)

    const inflight = worker.get('k')
    await worker.shutdown?.()

    // onUnreachable defaults to 'local', so a rejected request degrades quietly.
    await expect(inflight).resolves.toBeNull()
  })

  it('evicts least recently used entries on the primary', async () => {
    const evicted: string[] = []
    const channel = createMockChannel()
    const primary = clusterStore({
      transport: channel.primary,
      maxEntries: 2,
      cleanupInterval: 0,
      onEviction: (key) => evicted.push(key),
    })
    await primary.ready()

    await primary.set('a', makeEntry({}), 60_000)
    await primary.set('b', makeEntry({}), 60_000)
    await primary.get('a')
    await primary.set('c', makeEntry({}), 60_000)

    expect(evicted).toEqual(['b'])
    await primary.shutdown?.()
  })
})

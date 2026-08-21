import { describe, expect, it, vi } from 'vitest'
import type { StoreEntry } from '../../src/core/types.js'
import { withCache } from '../../src/stores/cache-layer.js'
import { memoryStore } from '../../src/stores/memory.js'

function createEntry(state = { count: 1 }): StoreEntry {
  return { state, expiresAt: Date.now() + 60000, createdAt: Date.now() }
}

describe('withCache', () => {
  it('caches get results locally', async () => {
    const remote = memoryStore({ cleanupInterval: 0 })
    const cached = withCache(remote, { localTtl: 5000 })

    await remote.set('key1', createEntry(), 60000)

    // First get - remote
    const r1 = await cached.get('key1')
    expect(r1).not.toBeNull()

    // Delete from remote
    await remote.delete('key1')

    // Should still return from local cache
    const r2 = await cached.get('key1')
    expect(r2).not.toBeNull()

    await cached.shutdown?.()
  })

  it('local cache expires after TTL', async () => {
    vi.useFakeTimers()
    const remote = memoryStore({ cleanupInterval: 0 })
    const cached = withCache(remote, { localTtl: 1000 })

    await cached.set('key1', createEntry(), 60000)

    // Delete from remote
    await remote.delete('key1')

    // Still cached locally
    expect(await cached.get('key1')).not.toBeNull()

    // Advance past local TTL
    vi.advanceTimersByTime(1001)
    expect(await cached.get('key1')).toBeNull()

    vi.useRealTimers()
    await cached.shutdown?.()
  })

  it('set updates both local and remote', async () => {
    const remote = memoryStore({ cleanupInterval: 0 })
    const cached = withCache(remote, { localTtl: 5000 })

    await cached.set('key1', createEntry({ count: 42 }), 60000)

    const fromRemote = await remote.get('key1')
    expect(fromRemote?.state).toEqual({ count: 42 })
    await cached.shutdown?.()
  })

  it('delete removes from both', async () => {
    const remote = memoryStore({ cleanupInterval: 0 })
    const cached = withCache(remote, { localTtl: 5000 })

    await cached.set('key1', createEntry(), 60000)
    await cached.delete('key1')

    expect(await cached.get('key1')).toBeNull()
    expect(await remote.get('key1')).toBeNull()
    await cached.shutdown?.()
  })

  it('atomic delegates to remote and caches result', async () => {
    const remote = memoryStore({ cleanupInterval: 0 })
    const cached = withCache(remote, { localTtl: 5000 })

    const result = await cached.atomic?.('key1', () => createEntry({ count: 5 }), 60000)
    expect(result.state).toEqual({ count: 5 })

    // Should be in local cache now
    await remote.delete('key1')
    const local = await cached.get('key1')
    expect(local?.state).toEqual({ count: 5 })
    await cached.shutdown?.()
  })

  it('respects maxLocalEntries', async () => {
    const remote = memoryStore({ cleanupInterval: 0 })
    const cached = withCache(remote, { localTtl: 60000, maxLocalEntries: 2 })

    await cached.set('key1', createEntry(), 60000)
    await cached.set('key2', createEntry(), 60000)
    await cached.set('key3', createEntry(), 60000)

    // All should be gettable from remote, but local cache pruned
    expect(await cached.get('key3')).not.toBeNull()
    await cached.shutdown?.()
  })
})

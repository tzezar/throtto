import { describe, expect, it } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { createHierarchyLimiter } from '../../src/limiter/hierarchy.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('createHierarchyLimiter', () => {
  function createHierarchy() {
    return createHierarchyLimiter({
      levels: [
        { name: 'org', algorithm: fixedWindow({ limit: 100, window: '1m' }) },
        { name: 'team', algorithm: fixedWindow({ limit: 50, window: '1m' }) },
        { name: 'user', algorithm: fixedWindow({ limit: 10, window: '1m' }) },
      ],
      resolveKeys: (ctx: string) => {
        // ctx = "org1:team1:user1"
        const [org, team, user] = ctx.split(':')
        return { org: org!, team: `${org}:${team}`, user: ctx }
      },
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  it('allows when all levels have capacity', async () => {
    const limiter = createHierarchy()
    const result = await limiter.check('acme:dev:alice')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('denies when user level exhausted', async () => {
    const limiter = createHierarchy()

    for (let i = 0; i < 10; i++) {
      await limiter.check('acme:dev:alice')
    }

    const denied = await limiter.check('acme:dev:alice')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('denies when team level exhausted', async () => {
    const limiter = createHierarchy()

    // 5 users each make 10 requests = 50 for team
    for (let u = 0; u < 5; u++) {
      for (let i = 0; i < 10; i++) {
        await limiter.check(`acme:dev:user${u}`)
      }
    }

    // New user in same team - team exhausted
    const denied = await limiter.check('acme:dev:newuser')
    expect(denied.allowed).toBe(false)
    await limiter.shutdown()
  })

  it('different teams are independent', async () => {
    const limiter = createHierarchy()

    // Fill team "dev"
    for (let u = 0; u < 5; u++) {
      for (let i = 0; i < 10; i++) {
        await limiter.check(`acme:dev:user${u}`)
      }
    }

    // Team "ops" should still have capacity
    const result = await limiter.check('acme:ops:bob')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })

  it('reset clears all levels for a context', async () => {
    const limiter = createHierarchy()

    for (let i = 0; i < 10; i++) {
      await limiter.check('acme:dev:alice')
    }

    await limiter.reset('acme:dev:alice')
    const result = await limiter.check('acme:dev:alice')
    expect(result.allowed).toBe(true)
    await limiter.shutdown()
  })
})

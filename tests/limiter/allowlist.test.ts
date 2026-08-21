import { describe, expect, it, vi } from 'vitest'
import { fixedWindow } from '../../src/algorithms/fixed-window.js'
import { withAllowlist } from '../../src/limiter/allowlist.js'
import { createLimiter } from '../../src/limiter/create-limiter.js'
import { memoryStore } from '../../src/stores/memory.js'

describe('withAllowlist', () => {
  function createTestLimiter() {
    return createLimiter({
      algorithm: fixedWindow({ limit: 1, window: '1m' }),
      store: memoryStore({ cleanupInterval: 0 }),
    })
  }

  describe('static allowlist', () => {
    it('bypasses rate limit for allowlisted keys', async () => {
      const limiter = withAllowlist(createTestLimiter(), {
        allowlist: ['admin', 'internal'],
      })

      // Would normally be denied after 1st request
      await limiter.check('admin')
      const result = await limiter.check('admin')
      expect(result.allowed).toBe(true)
      await limiter.shutdown()
    })

    it('still limits non-allowlisted keys', async () => {
      const limiter = withAllowlist(createTestLimiter(), {
        allowlist: ['admin'],
      })

      await limiter.check('user:1')
      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(false)
      await limiter.shutdown()
    })
  })

  describe('dynamic skip', () => {
    it('bypasses when skip returns true', async () => {
      const limiter = withAllowlist(createTestLimiter(), {
        skip: (ctx) => ctx.startsWith('internal:'),
      })

      await limiter.check('internal:service')
      const result = await limiter.check('internal:service')
      expect(result.allowed).toBe(true)
      await limiter.shutdown()
    })

    it('supports async skip', async () => {
      const limiter = withAllowlist(createTestLimiter(), {
        skip: async (ctx) => ctx === 'vip',
      })

      await limiter.check('vip')
      const result = await limiter.check('vip')
      expect(result.allowed).toBe(true)
      await limiter.shutdown()
    })

    it('limits when skip returns false', async () => {
      const limiter = withAllowlist(createTestLimiter(), {
        skip: () => false,
      })

      await limiter.check('user:1')
      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(false)
      await limiter.shutdown()
    })
  })

  describe('consume', () => {
    it('bypasses for allowlisted keys', async () => {
      const limiter = withAllowlist(createTestLimiter(), {
        allowlist: ['admin'],
      })

      await limiter.consume('admin')
      const result = await limiter.consume('admin')
      expect(result.allowed).toBe(true)
      await limiter.shutdown()
    })
  })
})

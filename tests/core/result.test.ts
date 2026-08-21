import { describe, expect, it } from 'vitest'
import {
  createAllowedResult,
  createDeniedResult,
  isAllowed,
  isDenied,
} from '../../src/core/result.js'
import type { RateLimitResult } from '../../src/core/types.js'

describe('result helpers', () => {
  describe('createAllowedResult', () => {
    it('creates an allowed result with correct shape', () => {
      const result = createAllowedResult({
        limit: 100,
        remaining: 99,
        resetAt: 1700000000000,
        cost: 1,
      })

      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(100)
      expect(result.remaining).toBe(99)
      expect(result.resetAt).toBe(1700000000000)
      expect(result.cost).toBe(1)
    })

    it('handles zero remaining', () => {
      const result = createAllowedResult({
        limit: 10,
        remaining: 0,
        resetAt: 1700000000000,
        cost: 10,
      })

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(0)
      expect(result.cost).toBe(10)
    })
  })

  describe('createDeniedResult', () => {
    it('creates a denied result with correct shape', () => {
      const result = createDeniedResult({
        limit: 100,
        remaining: 0,
        resetAt: 1700000000000,
        retryAfter: 5000,
        cost: 1,
      })

      expect(result.allowed).toBe(false)
      expect(result.limit).toBe(100)
      expect(result.remaining).toBe(0)
      expect(result.resetAt).toBe(1700000000000)
      expect(result.retryAfter).toBe(5000)
      expect(result.cost).toBe(1)
    })
  })

  describe('isAllowed', () => {
    it('returns true for allowed results', () => {
      const result: RateLimitResult = createAllowedResult({
        limit: 100,
        remaining: 99,
        resetAt: 1700000000000,
        cost: 1,
      })

      expect(isAllowed(result)).toBe(true)
    })

    it('returns false for denied results', () => {
      const result: RateLimitResult = createDeniedResult({
        limit: 100,
        remaining: 0,
        resetAt: 1700000000000,
        retryAfter: 5000,
        cost: 1,
      })

      expect(isAllowed(result)).toBe(false)
    })
  })

  describe('isDenied', () => {
    it('returns true for denied results', () => {
      const result: RateLimitResult = createDeniedResult({
        limit: 100,
        remaining: 0,
        resetAt: 1700000000000,
        retryAfter: 5000,
        cost: 1,
      })

      expect(isDenied(result)).toBe(true)
    })

    it('returns false for allowed results', () => {
      const result: RateLimitResult = createAllowedResult({
        limit: 100,
        remaining: 99,
        resetAt: 1700000000000,
        cost: 1,
      })

      expect(isDenied(result)).toBe(false)
    })
  })

  describe('type narrowing', () => {
    it('narrows to AllowedResult with isAllowed', () => {
      const result: RateLimitResult = createAllowedResult({
        limit: 100,
        remaining: 99,
        resetAt: 1700000000000,
        cost: 1,
      })

      if (isAllowed(result)) {
        // TypeScript should narrow this to AllowedResult
        expect(result.remaining).toBe(99)
        expect(result.cost).toBe(1)
      }
    })

    it('narrows to DeniedResult with isDenied', () => {
      const result: RateLimitResult = createDeniedResult({
        limit: 100,
        remaining: 0,
        resetAt: 1700000000000,
        retryAfter: 5000,
        cost: 1,
      })

      if (isDenied(result)) {
        // TypeScript should narrow this to DeniedResult
        expect(result.retryAfter).toBe(5000)
        expect(result.cost).toBe(1)
      }
    })
  })
})

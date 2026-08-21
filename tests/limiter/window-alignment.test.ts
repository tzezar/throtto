import { describe, expect, it } from 'vitest'
import {
  getAlignedWindowStart,
  getWindowEnd,
  getWindowIndex,
} from '../../src/limiter/window-alignment.js'

describe('window alignment', () => {
  const windowMs = 60000 // 1 minute

  describe('getAlignedWindowStart', () => {
    it('none strategy returns now', () => {
      const now = 1234567890
      const start = getAlignedWindowStart(now, { strategy: 'none', windowMs })
      expect(start).toBe(now)
    })

    it('floor strategy aligns to window boundary', () => {
      const now = windowMs * 100 + 30000 // 30s into window
      const start = getAlignedWindowStart(now, { strategy: 'floor', windowMs })
      expect(start).toBe(windowMs * 100)
    })

    it('floor strategy at exact boundary', () => {
      const now = windowMs * 50
      const start = getAlignedWindowStart(now, { strategy: 'floor', windowMs })
      expect(start).toBe(windowMs * 50)
    })

    it('custom strategy with offset', () => {
      const offset = 15000 // 15s offset
      const now = windowMs * 10 + 20000 // 20s past a minute boundary
      const start = getAlignedWindowStart(now, { strategy: 'custom', windowMs, offset })
      // (now - offset) = windowMs*10 + 5000
      // floor((windowMs*10 + 5000) / windowMs) * windowMs + offset = windowMs*10 + offset = windowMs*10 + 15000
      expect(start).toBe(windowMs * 10 + offset)
    })

    it('custom strategy without offset acts like floor', () => {
      const now = windowMs * 5 + 45000
      const start = getAlignedWindowStart(now, { strategy: 'custom', windowMs })
      expect(start).toBe(windowMs * 5)
    })
  })

  describe('getWindowEnd', () => {
    it('returns start + windowMs', () => {
      const start = windowMs * 10
      expect(getWindowEnd(start, windowMs)).toBe(windowMs * 11)
    })
  })

  describe('getWindowIndex', () => {
    it('returns the window number', () => {
      expect(getWindowIndex(0, windowMs)).toBe(0)
      expect(getWindowIndex(windowMs, windowMs)).toBe(1)
      expect(getWindowIndex(windowMs * 5 + 30000, windowMs)).toBe(5)
    })
  })
})

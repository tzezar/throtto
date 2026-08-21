import { describe, expect, it } from 'vitest'
import { parseDuration } from '../../src/core/duration.js'
import { ConfigError } from '../../src/core/errors.js'

describe('parseDuration', () => {
  describe('numeric input', () => {
    it('passes through positive numbers as milliseconds', () => {
      expect(parseDuration(1000)).toBe(1000)
      expect(parseDuration(0)).toBe(0)
      expect(parseDuration(500)).toBe(500)
    })

    it('handles floating point numbers', () => {
      expect(parseDuration(1.5)).toBe(1.5)
      expect(parseDuration(100.75)).toBe(100.75)
    })

    it('throws on negative numbers', () => {
      expect(() => parseDuration(-1)).toThrow(ConfigError)
      expect(() => parseDuration(-100)).toThrow(ConfigError)
    })

    it('throws on NaN', () => {
      expect(() => parseDuration(Number.NaN)).toThrow(ConfigError)
    })

    it('throws on Infinity', () => {
      expect(() => parseDuration(Number.POSITIVE_INFINITY)).toThrow(ConfigError)
      expect(() => parseDuration(Number.NEGATIVE_INFINITY)).toThrow(ConfigError)
    })
  })

  describe('milliseconds', () => {
    it('parses ms unit', () => {
      expect(parseDuration('100ms')).toBe(100)
      expect(parseDuration('1ms')).toBe(1)
      expect(parseDuration('0ms')).toBe(0)
      expect(parseDuration('1500ms')).toBe(1500)
    })
  })

  describe('seconds', () => {
    it('parses s unit', () => {
      expect(parseDuration('1s')).toBe(1000)
      expect(parseDuration('30s')).toBe(30000)
      expect(parseDuration('0s')).toBe(0)
      expect(parseDuration('60s')).toBe(60000)
    })
  })

  describe('minutes', () => {
    it('parses m unit', () => {
      expect(parseDuration('1m')).toBe(60000)
      expect(parseDuration('5m')).toBe(300000)
      expect(parseDuration('15m')).toBe(900000)
    })
  })

  describe('hours', () => {
    it('parses h unit', () => {
      expect(parseDuration('1h')).toBe(3600000)
      expect(parseDuration('2h')).toBe(7200000)
      expect(parseDuration('24h')).toBe(86400000)
    })
  })

  describe('days', () => {
    it('parses d unit', () => {
      expect(parseDuration('1d')).toBe(86400000)
      expect(parseDuration('7d')).toBe(604800000)
      expect(parseDuration('30d')).toBe(2592000000)
    })
  })

  describe('compound durations', () => {
    it('parses multiple units', () => {
      expect(parseDuration('1m30s')).toBe(90000)
      expect(parseDuration('1h30m')).toBe(5400000)
      expect(parseDuration('2h30m15s')).toBe(9015000)
      expect(parseDuration('1d12h')).toBe(129600000)
    })

    it('parses compound with ms', () => {
      expect(parseDuration('1s500ms')).toBe(1500)
      expect(parseDuration('1m500ms')).toBe(60500)
    })
  })

  describe('floating point in strings', () => {
    it('parses decimal values', () => {
      expect(parseDuration('1.5s')).toBe(1500)
      expect(parseDuration('0.5m')).toBe(30000)
      expect(parseDuration('2.5h')).toBe(9000000)
    })
  })

  describe('invalid input', () => {
    it('throws on empty string', () => {
      expect(() => parseDuration('' as any)).toThrow(ConfigError)
    })

    it('throws on invalid unit', () => {
      expect(() => parseDuration('10x' as any)).toThrow(ConfigError)
    })

    it('throws on plain number string without unit', () => {
      expect(() => parseDuration('100' as any)).toThrow(ConfigError)
    })

    it('throws on string with invalid characters', () => {
      expect(() => parseDuration('5m abc' as any)).toThrow(ConfigError)
    })

    it('throws on negative in string', () => {
      expect(() => parseDuration('-5s' as any)).toThrow(ConfigError)
    })

    it('error is instance of ConfigError', () => {
      try {
        parseDuration('invalid' as any)
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError)
        expect(e).toBeInstanceOf(Error)
      }
    })
  })
})

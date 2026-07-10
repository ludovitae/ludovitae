import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatMoney,
  formatMoneyCompact,
  formatMoneyDelta,
  formatMonthYear,
  formatProbability,
} from './format'

describe('formatMoney', () => {
  it('formats full dollars without cents', () => {
    expect(formatMoney(812400)).toBe('$812,400')
    expect(formatMoney(1234567.89)).toBe('$1,234,568')
    expect(formatMoney(0)).toBe('$0')
  })
  it('formats negatives', () => {
    expect(formatMoney(-315000)).toBe('-$315,000')
  })
  it('formats cents when asked', () => {
    expect(formatMoney(1234.5, { cents: true })).toBe('$1,234.50')
  })
  it('handles non-finite input', () => {
    expect(formatMoney(NaN)).toBe('—')
    expect(formatMoney(Infinity)).toBe('—')
  })
})

describe('formatMoneyCompact', () => {
  it('uses K/M/B with one decimal below 100', () => {
    expect(formatMoneyCompact(1400000)).toBe('$1.4M')
    expect(formatMoneyCompact(812400)).toBe('$812K')
    expect(formatMoneyCompact(950)).toBe('$950')
    expect(formatMoneyCompact(2100000000)).toBe('$2.1B')
  })
  it('trims trailing .0', () => {
    expect(formatMoneyCompact(2000000)).toBe('$2M')
  })
  it('keeps the sign in front of the $', () => {
    expect(formatMoneyCompact(-3200)).toBe('-$3.2K')
  })
})

describe('formatMoneyDelta', () => {
  it('always signs', () => {
    expect(formatMoneyDelta(12300)).toBe('+$12,300')
    expect(formatMoneyDelta(-4100)).toBe('-$4,100')
  })
})

describe('formatProbability', () => {
  it('rounds to whole percent', () => {
    expect(formatProbability(0.873)).toBe('87%')
    expect(formatProbability(1)).toBe('100%')
    expect(formatProbability(0)).toBe('0%')
  })
})

describe('dates', () => {
  it('formats ISO dates', () => {
    expect(formatDate('2032-06-01')).toBe('Jun 1, 2032')
    expect(formatMonthYear('2026-07-10')).toBe('Jul 2026')
  })
  it('rejects malformed input gracefully', () => {
    expect(formatDate('not-a-date')).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatMonthYear(undefined)).toBe('—')
  })
})

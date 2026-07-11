import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatMoney,
  formatMoneyCompact,
  formatMoneyDelta,
  formatMonthYear,
  formatProbability,
  formatProbabilityApprox,
  probabilityTitle,
  roundProbability5,
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

describe('formatMoney negatives and zero (T-003)', () => {
  it('formats large negatives with cents', () => {
    expect(formatMoney(-1234567.89)).toBe('-$1,234,568')
    expect(formatMoney(-1234.5, { cents: true })).toBe('-$1,234.50')
  })
  it('formats zero without a sign', () => {
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(0, { cents: true })).toBe('$0.00')
  })
})

describe('formatMoneyCompact boundaries (T-003)', () => {
  it('crosses the K threshold at exactly 1000', () => {
    expect(formatMoneyCompact(999)).toBe('$999')
    expect(formatMoneyCompact(1000)).toBe('$1K')
  })
  it('switches from one-decimal to whole at 100 units', () => {
    expect(formatMoneyCompact(99900)).toBe('$99.9K')
    expect(formatMoneyCompact(100000)).toBe('$100K')
  })
  it('crosses M and B thresholds exactly', () => {
    expect(formatMoneyCompact(1_000_000)).toBe('$1M')
    expect(formatMoneyCompact(1_500_000_000)).toBe('$1.5B')
  })
  it('keeps the sign for negative magnitudes across thresholds', () => {
    expect(formatMoneyCompact(-1_000_000)).toBe('-$1M')
    expect(formatMoneyCompact(-999)).toBe('-$999')
  })
  it('formats zero and negative-zero as $0', () => {
    expect(formatMoneyCompact(0)).toBe('$0')
    expect(formatMoneyCompact(-0)).toBe('$0')
  })
  it('rounds a near-million just under 1e6 to $1000K (documented boundary, F-002)', () => {
    // cosmetic: 999_999 renders as $1000K rather than $1M — locked as current
    // behavior; see T-003 log F-002.
    expect(formatMoneyCompact(999_999)).toBe('$1000K')
  })
})

describe('formatMoneyDelta', () => {
  it('always signs', () => {
    expect(formatMoneyDelta(12300)).toBe('+$12,300')
    expect(formatMoneyDelta(-4100)).toBe('-$4,100')
  })
  it('signs zero as positive (T-003)', () => {
    expect(formatMoneyDelta(0)).toBe('+$0')
  })
})

describe('formatProbability', () => {
  it('rounds to whole percent', () => {
    expect(formatProbability(0.873)).toBe('87%')
    expect(formatProbability(1)).toBe('100%')
    expect(formatProbability(0)).toBe('0%')
  })
})

describe('formatProbabilityApprox (T-011 model honesty)', () => {
  it('rounds to the nearest 5%', () => {
    expect(formatProbabilityApprox(0.737)).toBe('~75%')
    expect(formatProbabilityApprox(0.872)).toBe('~85%')
    expect(formatProbabilityApprox(0.88)).toBe('~90%')
    expect(formatProbabilityApprox(1)).toBe('~100%')
    expect(formatProbabilityApprox(0)).toBe('~0%')
    expect(formatProbabilityApprox(NaN)).toBe('—')
  })
  it('clamps out-of-range input', () => {
    expect(roundProbability5(1.2)).toBe(100)
    expect(roundProbability5(-0.1)).toBe(0)
  })
  it('pairs the display with an exact-value title', () => {
    expect(probabilityTitle(0.737)).toBe('About 75% — this run computed 74%')
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

import { describe, expect, it } from 'vitest'
import type { RecurringCharge } from '@/api/types'
import { groupRecurring, monthlyTotal, priceChangeLabel } from './recurring'

function charge(over: Partial<RecurringCharge>): RecurringCharge {
  return {
    payee: 'Netflix',
    category: 'subscriptions',
    cadence: 'monthly',
    typical_amount: 15.49,
    last_amount: 15.49,
    price_change_pct: 0,
    last_date: '2026-06-28',
    first_seen: '2024-07-28',
    occurrences: 24,
    active: true,
    monthly_equivalent: 15.49,
    ...over,
  }
}

describe('groupRecurring', () => {
  const charges = [
    charge({ payee: 'Netflix', monthly_equivalent: 17.99, price_change_pct: 16.1 }),
    charge({ payee: 'Apex Gym', monthly_equivalent: 34 }),
    charge({ payee: 'CloudVault Storage', monthly_equivalent: 2.99 }),
    charge({ payee: 'HBO Max', monthly_equivalent: 15.99, active: false }),
    charge({ payee: 'Rocket Mortgage', category: 'housing', monthly_equivalent: 2350 }),
    charge({ payee: 'Amazon Prime', cadence: 'annual', monthly_equivalent: 11.58 }),
  ]
  const forgotten = new Set(['Apex Gym', 'CloudVault Storage', 'Amazon Prime'])

  it('splits into forgotten / active / lapsed', () => {
    const g = groupRecurring(charges, forgotten)
    expect(g.forgotten.map((c) => c.payee)).toEqual(['Apex Gym', 'Amazon Prime', 'CloudVault Storage'])
    expect(g.active.map((c) => c.payee)).toEqual(['Rocket Mortgage', 'Netflix'])
    expect(g.lapsed.map((c) => c.payee)).toEqual(['HBO Max'])
  })

  it('sorts every group by monthly equivalent, descending', () => {
    const g = groupRecurring(charges, forgotten)
    for (const group of [g.forgotten, g.active, g.lapsed]) {
      const values = group.map((c) => c.monthly_equivalent)
      expect(values).toEqual([...values].sort((a, b) => b - a))
    }
  })

  it('a lapsed charge never lands in the forgotten callout', () => {
    const g = groupRecurring(
      [charge({ payee: 'HBO Max', active: false })],
      new Set(['HBO Max']),
    )
    expect(g.forgotten).toHaveLength(0)
    expect(g.lapsed.map((c) => c.payee)).toEqual(['HBO Max'])
  })

  it('handles empty input', () => {
    const g = groupRecurring([], new Set())
    expect(g).toEqual({ forgotten: [], active: [], lapsed: [] })
  })
})

describe('monthlyTotal', () => {
  it('sums monthly equivalents to cents', () => {
    expect(monthlyTotal([charge({ monthly_equivalent: 17.99 }), charge({ monthly_equivalent: 2.99 })])).toBe(
      20.98,
    )
    expect(monthlyTotal([])).toBe(0)
  })
})

describe('priceChangeLabel', () => {
  it('formats increases and decreases, hides steady prices', () => {
    expect(priceChangeLabel(16.1)).toBe('+16.1%')
    expect(priceChangeLabel(-8)).toBe('−8.0%')
    expect(priceChangeLabel(0)).toBeNull()
  })
})

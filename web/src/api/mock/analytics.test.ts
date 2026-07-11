/** The mock analytics back every v1.2 hub view — pin the behaviors the UI
 * (and the demo) rely on: transfer exclusion, subscription detection with the
 * price hike, the forgotten group, freshness states. */

import { describe, expect, it } from 'vitest'
import {
  detectRecurring,
  forecast,
  freshnessOf,
  hotspots,
  spendingSummary,
  suggestCategories,
} from './analytics'
import * as db from './db'
import type { Account } from '../types'

describe('spendingSummary', () => {
  it('excludes transfer-paired transactions entirely', () => {
    const paired = db.transactions.filter((t) => t.transfer_pair_id !== null && t.amount < 0)
    expect(paired.length).toBeGreaterThan(10) // the auto-paired card payments exist…
    const s = spendingSummary()
    // …and the grand total is exactly the unpaired outflows in the window.
    const first = `${s.months[0]}-01`
    const unpairedTotal = db.transactions
      .filter((t) => t.amount < 0 && t.transfer_pair_id === null && t.date >= first)
      .reduce((sum, t) => sum - t.amount, 0)
    expect(s.grand_total).toBeCloseTo(unpairedTotal, 0)
    expect(s.categories.every((c) => c.totals.length === s.months.length)).toBe(true)
  })

  it('orders categories by total, descending', () => {
    const totals = spendingSummary().categories.map((c) => c.total)
    expect(totals).toEqual([...totals].sort((a, b) => b - a))
  })
})

describe('detectRecurring', () => {
  const rec = detectRecurring()
  const byPayee = new Map(rec.map((r) => [r.payee, r]))

  it('finds the fixed-day subscriptions and skips variable spending', () => {
    expect(byPayee.has('Netflix')).toBe(true)
    expect(byPayee.has('Apex Gym')).toBe(true)
    expect(byPayee.has('CloudVault Storage')).toBe(true)
    // random-day merchants are not recurring
    expect(byPayee.has('New Seasons Market')).toBe(false)
    expect(byPayee.has('Nostrana')).toBe(false)
  })

  it('flags the Netflix price hike without disqualifying it', () => {
    const nf = byPayee.get('Netflix')!
    expect(nf.cadence).toBe('monthly')
    expect(nf.typical_amount).toBe(15.49)
    expect(nf.last_amount).toBe(17.99)
    expect(nf.price_change_pct).toBeCloseTo(16.1, 1)
    expect(nf.active).toBe(true)
  })

  it('detects the annual charge and computes its monthly equivalent', () => {
    const prime = byPayee.get('Amazon Prime')!
    expect(prime.cadence).toBe('annual')
    expect(prime.monthly_equivalent).toBeCloseTo(139 / 12, 2)
  })

  it('marks the cancelled subscription lapsed', () => {
    expect(byPayee.get('HBO Max')!.active).toBe(false)
  })

  it('reports amount variability (ruling 2026-07-11) — flat subs 0, hikes and habits > 5', () => {
    expect(byPayee.get('Spotify')!.amount_variability_pct).toBe(0)
    expect(byPayee.get('Apex Gym')!.amount_variability_pct).toBe(0)
    // the step change makes Netflix "variable" by the raw metric (~7%)
    expect(byPayee.get('Netflix')!.amount_variability_pct).toBeGreaterThan(5)
    // the weekly habit is detected but clearly variable
    const habit = byPayee.get('Green Basket Farm Share')!
    expect(habit.cadence).toBe('weekly')
    expect(habit.amount_variability_pct).toBeGreaterThan(5)
  })
})

describe('hotspots', () => {
  const h = hotspots(6)

  it('groups the long-running flat charges as possibly forgotten', () => {
    const payees = h.possibly_forgotten.map((r) => r.payee)
    expect(payees).toContain('Apex Gym')
    expect(payees).toContain('CloudVault Storage')
    // too young (8 months)
    expect(payees).not.toContain('Spotify')
    // variability > 5% disqualifies (Netflix via its hike, the habit via jitter)
    expect(payees).not.toContain('Netflix')
    expect(payees).not.toContain('Green Basket Farm Share')
    // ≤ $100/mo cap: a mortgage is recurring, not forgettable (ruling)
    expect(payees).not.toContain('Rocket Mortgage')
  })

  it('lists the price increase and the dining spike (increases only, ≥ 20%)', () => {
    expect(h.price_increases.map((r) => r.payee)).toContain('Netflix')
    const dining = h.category_spikes.find((s) => s.category === 'dining')
    expect(dining).toBeDefined()
    expect(dining!.delta_pct).toBeGreaterThanOrEqual(20)
    // T-007 windows: increases only, over a ≥ $20/mo baseline
    for (const s of h.category_spikes) {
      expect(s.delta_pct).toBeGreaterThanOrEqual(20)
      expect(s.baseline_monthly_avg).toBeGreaterThanOrEqual(20)
    }
  })

  it('top merchants: max 10, store numbers folded, paired transfers excluded', () => {
    expect(h.top_merchants.length).toBeLessThanOrEqual(10)
    const payees = h.top_merchants.map((t) => t.payee)
    expect(payees).not.toContain('Payment to Sapphire Card')
    // no normalized merchant name ends in a store/reference number
    for (const p of payees) expect(/\d$/.test(p)).toBe(false)
  })
})

describe('forecast', () => {
  it('projects aligned series with flat variable averages (T-007 shape)', () => {
    const f = forecast(12)
    expect(f.months).toHaveLength(12)
    expect(f.recurring).toHaveLength(12)
    expect(f.total).toHaveLength(12)
    expect(f.recurring[0]!).toBeGreaterThan(0)
    const variableMonthly = f.variable_by_category.reduce((s, c) => s + c.monthly_avg, 0)
    for (let i = 0; i < 12; i++) expect(f.total[i]!).toBeCloseTo(f.recurring[i]! + variableMonthly, 1)
  })

  it('lumps annual charges in their anniversary month', () => {
    const f = forecast(12)
    const max = Math.max(...f.recurring)
    const min = Math.min(...f.recurring)
    // exactly the Prime renewal ($139) separates the anniversary month
    expect(max - min).toBeCloseTo(139, 0)
    expect(f.recurring.filter((v) => v === max)).toHaveLength(1)
  })
})

describe('suggestCategories', () => {
  it('returns one positional entry per payee, null when unmatched', () => {
    const res = suggestCategories(['SQ *BLUE STAR DONUTS', 'ZZZ UNKNOWN VENDOR'])
    expect(res.suggestions).toHaveLength(2)
    expect(res.suggestions[0]).toMatchObject({ category: 'dining' })
    expect(res.suggestions[1]).toMatchObject({ category: null, confidence: 0 })
  })
})

describe('freshnessOf', () => {
  const base = db.accounts.find((a) => a.id === 1)!

  function acct(over: Partial<Account>): Account {
    return { ...base, ...over }
  }

  it('computes the five states from import recency and threshold', () => {
    const day = (n: number) => {
      const d = new Date()
      d.setDate(d.getDate() - n)
      return `${d.toISOString().slice(0, 10)}T09:00:00`
    }
    expect(freshnessOf(acct({ last_import_at: day(3) })).freshness).toBe('fresh')
    expect(freshnessOf(acct({ last_import_at: day(27) })).freshness).toBe('aging')
    expect(freshnessOf(acct({ last_import_at: day(61) })).freshness).toBe('stale')
    expect(
      freshnessOf(acct({ last_import_at: null, newest_transaction_date: null })).freshness,
    ).toBe('never')
    expect(freshnessOf(acct({ track_freshness: false })).freshness).toBe('off')
    // per-account override moves the boundary: 27 days is fresh at 90
    expect(freshnessOf(acct({ last_import_at: day(27), staleness_days: 90 })).freshness).toBe('fresh')
    expect(freshnessOf(acct({ last_import_at: day(61), staleness_days: 90 })).freshness).toBe('aging')
  })
})

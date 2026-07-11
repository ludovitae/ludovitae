/** The mock analytics back every v1.2 hub view — pin the behaviors the UI
 * (and the demo) rely on: transfer exclusion, subscription detection with the
 * price hike, the forgotten group, freshness states. */

import { describe, expect, it } from 'vitest'
import { detectRecurring, forecast, freshnessOf, hotspots, spendingSummary } from './analytics'
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
})

describe('hotspots', () => {
  const h = hotspots(6)

  it('groups the long-running flat charges as possibly forgotten', () => {
    const payees = h.possibly_forgotten.map((r) => r.payee)
    expect(payees).toContain('Apex Gym')
    expect(payees).toContain('CloudVault Storage')
    // too young (8 months)
    expect(payees).not.toContain('Spotify')
    // price change disqualifies
    expect(payees).not.toContain('Netflix')
    // big fixed bills are not "forgotten"
    expect(payees).not.toContain('Rocket Mortgage')
  })

  it('lists the price increase and the dining spike', () => {
    expect(h.price_increases.map((r) => r.payee)).toContain('Netflix')
    const dining = h.category_spikes.find((s) => s.category === 'dining')
    expect(dining).toBeDefined()
    expect(dining!.delta_pct).toBeGreaterThan(10)
  })

  it('top merchants exclude paired transfer payees', () => {
    expect(h.top_merchants.map((t) => t.payee)).not.toContain('Payment to Sapphire Card')
  })
})

describe('forecast', () => {
  it('projects aligned recurring + variable + total series', () => {
    const f = forecast(12)
    expect(f.months).toHaveLength(12)
    expect(f.recurring).toHaveLength(12)
    expect(f.total).toHaveLength(12)
    expect(f.recurring[0]!).toBeGreaterThan(0)
    const variable0 = f.variable_by_category.reduce((s, c) => s + (c.totals[0] ?? 0), 0)
    expect(f.total[0]!).toBeCloseTo(f.recurring[0]! + variable0, 1)
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

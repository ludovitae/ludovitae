import { describe, expect, it } from 'vitest'
import type { Account, Flow, Profile } from '../types'
import { runMockSim } from './sim'

const profile: Profile = {
  birth_year: 1980,
  retirement_age: 65,
  life_expectancy: 92,
  annual_retirement_spending: 80000,
  social_security_monthly: 2200,
  social_security_start_age: 67,
  inflation_pct: 2.5,
  effective_tax_rate_pct: 18,
}

const accounts: Account[] = [
  {
    id: 1, name: 'Brokerage', type: 'brokerage', institution: '', balance: 400000,
    growth_rate_pct: null, asset_class: 'stocks', include_in_net_worth: true, notes: '', created_at: '2026-01-01',
  },
  {
    id: 2, name: 'Checking', type: 'checking', institution: '', balance: 20000,
    growth_rate_pct: null, asset_class: 'cash', include_in_net_worth: true, notes: '', created_at: '2026-01-01',
  },
]

const flows: Flow[] = [
  { id: 1, name: 'Salary', kind: 'income', amount_monthly: 10000, annual_growth_pct: 3, start_date: null, end_date: null, account_id: null, category: 'salary', ends_at_retirement: true },
  { id: 2, name: 'Living', kind: 'expense', amount_monthly: 6000, annual_growth_pct: 0, start_date: null, end_date: null, account_id: null, category: 'living', ends_at_retirement: false },
  { id: 3, name: '401k', kind: 'contribution', amount_monthly: 1500, annual_growth_pct: 0, start_date: null, end_date: null, account_id: 1, category: 'retirement', ends_at_retirement: true },
]

const base = { profile, accounts, flows, nPaths: 300, seed: 42 }

describe('runMockSim', () => {
  it('matches the /simulate response shape', () => {
    const r = runMockSim({ ...base, params: {} })
    expect(r.ages[0]).toBe(new Date().getFullYear() - profile.birth_year)
    expect(r.ages[r.ages.length - 1]).toBe(profile.life_expectancy)
    expect(r.percentiles.p50.length).toBe(r.ages.length)
    expect(r.deterministic.net_worth.length).toBe(r.ages.length)
    expect(r.success_probability).toBeGreaterThanOrEqual(0)
    expect(r.success_probability).toBeLessThanOrEqual(1)
  })

  it('is deterministic for a given seed', () => {
    const a = runMockSim({ ...base, params: {} })
    const b = runMockSim({ ...base, params: {} })
    expect(a.percentiles.p50).toEqual(b.percentiles.p50)
    expect(a.success_probability).toBe(b.success_probability)
  })

  it('keeps percentile bands ordered', () => {
    const r = runMockSim({ ...base, params: {} })
    for (let i = 0; i < r.ages.length; i++) {
      expect(r.percentiles.p10[i]!).toBeLessThanOrEqual(r.percentiles.p50[i]!)
      expect(r.percentiles.p50[i]!).toBeLessThanOrEqual(r.percentiles.p90[i]!)
    }
  })

  it('responds to parameters: saving more raises the median ending', () => {
    const lo = runMockSim({ ...base, params: { monthly_savings_delta: -1500 } })
    const hi = runMockSim({ ...base, params: { monthly_savings_delta: 1500 } })
    expect(hi.ending_net_worth.p50).toBeGreaterThan(lo.ending_net_worth.p50)
  })

  it('responds to parameters: retiring very early with high spending hurts success', () => {
    const early = runMockSim({ ...base, params: { retirement_age: 48, annual_retirement_spending: 120000 } })
    const late = runMockSim({ ...base, params: { retirement_age: 70, annual_retirement_spending: 50000 } })
    expect(late.success_probability).toBeGreaterThan(early.success_probability)
  })
})

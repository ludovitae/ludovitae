import { describe, expect, it } from 'vitest'
import type { Account, Flow, HouseholdMember, Profile, SpendingProfile } from '../types'
import { buildMilestones, runMockSim } from './sim'

const profile: Profile = {
  annual_retirement_spending: 80000,
  inflation_pct: 2.5,
  effective_tax_rate_pct: 18,
}

const household: HouseholdMember[] = [
  {
    id: 1, name: 'Brian', role: 'self', birth_year: 1980, life_expectancy: 92,
    retirement_age: 65, ss_monthly_at_fra: 2200, ss_claim_age: 67, notes: '',
  },
  {
    id: 2, name: 'Dana', role: 'partner', birth_year: 1983, life_expectancy: 94,
    retirement_age: 67, ss_monthly_at_fra: 1600, ss_claim_age: 67, notes: '',
  },
  {
    id: 3, name: 'Wren', role: 'child', birth_year: 2012, life_expectancy: 95,
    retirement_age: null, ss_monthly_at_fra: null, ss_claim_age: null, notes: '',
  },
]

const accounts: Account[] = [
  {
    id: 1, name: 'Brokerage', type: 'brokerage', institution: '', balance: 400000,
    growth_rate_pct: null, asset_class: 'stocks', member_id: null,
    include_in_net_worth: true, notes: '', created_at: '2026-01-01',
  },
  {
    id: 2, name: 'Checking', type: 'checking', institution: '', balance: 20000,
    growth_rate_pct: null, asset_class: 'cash', member_id: null,
    include_in_net_worth: true, notes: '', created_at: '2026-01-01',
  },
  {
    id: 3, name: '401k', type: 'retirement', institution: '', balance: 250000,
    growth_rate_pct: null, asset_class: 'mixed', member_id: 1,
    include_in_net_worth: true, notes: '', created_at: '2026-01-01',
  },
  {
    id: 4, name: '403b', type: 'retirement', institution: '', balance: 90000,
    growth_rate_pct: null, asset_class: 'mixed', member_id: 2,
    include_in_net_worth: true, notes: '', created_at: '2026-01-01',
  },
]

const flows: Flow[] = [
  { id: 1, name: 'Salary — Brian', kind: 'income', amount_monthly: 10000, annual_growth_pct: 3, start_date: null, end_date: null, account_id: null, category: 'salary', member_id: 1, ends_at_retirement: true },
  { id: 2, name: 'Salary — Dana', kind: 'income', amount_monthly: 6000, annual_growth_pct: 3, start_date: null, end_date: null, account_id: null, category: 'salary', member_id: 2, ends_at_retirement: true },
  { id: 3, name: 'Mortgage', kind: 'expense', amount_monthly: 2300, annual_growth_pct: 0, start_date: null, end_date: null, account_id: null, category: 'housing', member_id: null, ends_at_retirement: false },
  { id: 4, name: '401k', kind: 'contribution', amount_monthly: 1500, annual_growth_pct: 0, start_date: null, end_date: null, account_id: 3, category: 'retirement', member_id: 1, ends_at_retirement: true },
]

const spending: SpendingProfile = {
  categories: [
    { id: 1, name: 'Groceries', monthly_amount: 1000, kind: 'essential', annual_growth_pct: null },
    { id: 2, name: 'Dining out', monthly_amount: 500, kind: 'discretionary', annual_growth_pct: null },
  ],
  monthly_savings_target: 1500,
}

const base = { profile, household, accounts, flows, spending, nPaths: 300, seed: 42 }
const selfAge0 = new Date().getFullYear() - 1980

describe('runMockSim (v1.1)', () => {
  it('matches the /simulate response shape on the self-age axis', () => {
    const r = runMockSim({ ...base, params: {} })
    expect(r.ages[0]).toBe(selfAge0)
    // horizon runs to the LATEST life expectancy in the household (Dana: 2077)
    expect(r.start_year + r.ages.length - 1).toBe(1983 + 94)
    expect(r.percentiles.p50.length).toBe(r.ages.length)
    expect(r.deterministic.net_worth.length).toBe(r.ages.length)
    expect(r.success_probability).toBeGreaterThanOrEqual(0)
    expect(r.success_probability).toBeLessThanOrEqual(1)
    expect(Array.isArray(r.milestones)).toBe(true)
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
    const early = runMockSim({
      ...base,
      params: {
        member_overrides: { '1': { retirement_age: 48 }, '2': { retirement_age: 48 } },
        annual_retirement_spending: 140000,
      },
    })
    const late = runMockSim({
      ...base,
      params: {
        member_overrides: { '1': { retirement_age: 70 }, '2': { retirement_age: 70 } },
        annual_retirement_spending: 50000,
      },
    })
    expect(late.success_probability).toBeGreaterThan(early.success_probability)
  })

  it('spending_delta_pct scales categories + expense flows (more spend = worse)', () => {
    const lean = runMockSim({ ...base, params: { spending_delta_pct: -20 } })
    const rich = runMockSim({ ...base, params: { spending_delta_pct: 20 } })
    expect(lean.ending_net_worth.p50).toBeGreaterThan(rich.ending_net_worth.p50)
  })

  it('claiming SS later (bigger factor) beats claiming at 62, all else equal', () => {
    const at62 = runMockSim({ ...base, params: { member_overrides: { '1': { ss_claim_age: 62 }, '2': { ss_claim_age: 62 } } } })
    const at70 = runMockSim({ ...base, params: { member_overrides: { '1': { ss_claim_age: 70 }, '2': { ss_claim_age: 70 } } } })
    expect(at70.ending_net_worth.p50).toBeGreaterThan(at62.ending_net_worth.p50)
  })
})

describe('milestones (engine output)', () => {
  it('emits retirement / ss_start / rmd_start per member on the self-age axis, sorted', () => {
    const r = runMockSim({ ...base, params: {} })
    const kinds = r.milestones.map((m) => `${m.member_id}:${m.kind}`)
    expect(kinds).toContain('1:retirement')
    expect(kinds).toContain('1:ss_start')
    expect(kinds).toContain('1:rmd_start')
    expect(kinds).toContain('2:retirement')
    expect(kinds).toContain('2:ss_start')
    expect(kinds).toContain('2:rmd_start')
    // the child has no timing milestones
    expect(kinds.some((k) => k.startsWith('3:'))).toBe(false)
    for (let i = 1; i < r.milestones.length; i++) {
      expect(r.milestones[i]!.age).toBeGreaterThanOrEqual(r.milestones[i - 1]!.age)
    }
    // partner events land on the SELF age axis (Dana retires at her 67 = Brian's 70)
    const danaRetire = r.milestones.find((m) => m.member_id === 2 && m.kind === 'retirement')!
    expect(danaRetire.year).toBe(1983 + 67)
    expect(danaRetire.age).toBe(1983 + 67 - 1980)
  })

  it('reflects member_overrides and the claim-age factor in labels', () => {
    const r = runMockSim({
      ...base,
      params: { member_overrides: { '1': { retirement_age: 55, ss_claim_age: 62 } } },
    })
    const retire = r.milestones.find((m) => m.member_id === 1 && m.kind === 'retirement')!
    expect(retire.age).toBe(55)
    expect(retire.year).toBe(1980 + 55)
    const ss = r.milestones.find((m) => m.member_id === 1 && m.kind === 'ss_start')!
    expect(ss.age).toBe(62)
    expect(ss.label).toBe('Brian claims Social Security (70% of FRA)')
  })

  it('honors the top-level retirement_age sugar for the self member', () => {
    const r = runMockSim({ ...base, params: { retirement_age: 58 } })
    const retire = r.milestones.find((m) => m.member_id === 1 && m.kind === 'retirement')!
    expect(retire.age).toBe(58)
    // an explicit override wins over the sugar
    const r2 = runMockSim({
      ...base,
      params: { retirement_age: 58, member_overrides: { '1': { retirement_age: 60 } } },
    })
    expect(r2.milestones.find((m) => m.member_id === 1 && m.kind === 'retirement')!.age).toBe(60)
  })

  it('starts RMDs at 73 for pre-1960 births and 75 otherwise', () => {
    const older: HouseholdMember = {
      id: 9, name: 'Pat', role: 'self', birth_year: 1955, life_expectancy: 95,
      retirement_age: 65, ss_monthly_at_fra: 2000, ss_claim_age: 67, notes: '',
    }
    const acct: Account = { ...accounts[2]!, member_id: 9 }
    const ms = buildMilestones([older], [acct], {}, 0, 200)
    expect(ms.find((m) => m.kind === 'rmd_start')!.age).toBe(73)
    const ms75 = buildMilestones(
      [{ ...older, birth_year: 1980 }],
      [{ ...acct }],
      {},
      0,
      200,
    )
    expect(ms75.find((m) => m.kind === 'rmd_start')!.age).toBe(75)
  })

  it('assigns unowned tax-deferred accounts to self for RMD timing and omits beyond-horizon milestones', () => {
    const unowned: Account = { ...accounts[2]!, member_id: null }
    const ms = buildMilestones(household, [unowned], {}, selfAge0, 200)
    const rmds = ms.filter((m) => m.kind === 'rmd_start')
    expect(rmds).toHaveLength(1)
    expect(rmds[0]!.member_id).toBe(1)
    // horizon cut: nothing beyond maxSelfAge survives
    const clipped = buildMilestones(household, [unowned], {}, selfAge0, 60)
    expect(clipped.every((m) => m.age <= 60)).toBe(true)
  })
})

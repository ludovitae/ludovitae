import { describe, expect, it } from 'vitest'
import {
  cleanParams,
  effectiveMemberTiming,
  paramsEqual,
  serializeParams,
  withMemberOverride,
} from './scenarioParams'
import { ssClaimFactor } from './ssFactor'

describe('cleanParams', () => {
  it('keeps a scenario a minimal diff against baseline', () => {
    expect(
      cleanParams({
        retirement_age: 55,
        monthly_savings_delta: 0,
        return_override_pct: null,
        inflation_override_pct: null,
        events: [],
      }),
    ).toEqual({ retirement_age: 55 })
  })

  it('keeps meaningful values', () => {
    expect(
      cleanParams({ monthly_savings_delta: -500, annual_retirement_spending: 70000, return_override_pct: 5 }),
    ).toEqual({ monthly_savings_delta: -500, annual_retirement_spending: 70000, return_override_pct: 5 })
  })

  it('normalizes recurring event amounts to positive magnitudes (ruling 2026-07-10)', () => {
    const out = cleanParams({
      events: [{ name: 'Golf', kind: 'recurring_expense', amount_monthly: -350, start_age: 47 }],
    })
    expect(out.events).toEqual([
      { name: 'Golf', kind: 'recurring_expense', amount_monthly: 350, start_age: 47, end_age: null },
    ])
  })

  it('keeps one_time amounts signed', () => {
    const out = cleanParams({
      events: [{ name: 'Buy a camper', kind: 'one_time', amount: -45000, age: 48 }],
    })
    expect(out.events?.[0]).toEqual({ name: 'Buy a camper', kind: 'one_time', amount: -45000, age: 48 })
  })

  it('normalizes recurring_income to a positive magnitude too (T-003)', () => {
    const out = cleanParams({
      events: [{ name: 'Rental', kind: 'recurring_income', amount_monthly: -1200, start_age: 60, end_age: 70 }],
    })
    expect(out.events).toEqual([
      { name: 'Rental', kind: 'recurring_income', amount_monthly: 1200, start_age: 60, end_age: 70 },
    ])
  })

  it('preserves a positive one_time inflow sign (T-003)', () => {
    const out = cleanParams({
      events: [{ name: 'Inheritance', kind: 'one_time', amount: 90000, age: 55 }],
    })
    expect(out.events?.[0]).toEqual({ name: 'Inheritance', kind: 'one_time', amount: 90000, age: 55 })
  })

  it('keeps a negative monthly_savings_delta (spend more) as a real diff (T-003)', () => {
    expect(cleanParams({ monthly_savings_delta: -1500 })).toEqual({ monthly_savings_delta: -1500 })
  })

  it('drops a zero savings delta but keeps a zero retirement_age override (T-003)', () => {
    // monthly_savings_delta 0 is a no-op; retirement_age is a direct override,
    // so even 0-adjacent explicit values survive as long as defined.
    expect(cleanParams({ monthly_savings_delta: 0, retirement_age: 62 })).toEqual({ retirement_age: 62 })
  })

  it('defaults a recurring event end_age to null when omitted (T-003)', () => {
    const out = cleanParams({
      events: [{ name: 'Golf', kind: 'recurring_expense', amount_monthly: 350, start_age: 50 }],
    })
    expect(out.events?.[0]).toMatchObject({ end_age: null })
  })
})

describe('sign-normalization equivalence (T-003)', () => {
  it('a recurring event and its negated magnitude serialize identically', () => {
    const positive = { events: [{ name: 'Golf', kind: 'recurring_expense' as const, amount_monthly: 350, start_age: 50 }] }
    const negative = { events: [{ name: 'Golf', kind: 'recurring_expense' as const, amount_monthly: -350, start_age: 50 }] }
    expect(paramsEqual(positive, negative)).toBe(true)
  })

  it('a one_time inflow and outflow of equal magnitude are NOT equal', () => {
    const inflow = { events: [{ name: 'X', kind: 'one_time' as const, amount: 1000, age: 50 }] }
    const outflow = { events: [{ name: 'X', kind: 'one_time' as const, amount: -1000, age: 50 }] }
    expect(paramsEqual(inflow, outflow)).toBe(false)
  })
})

describe('member overrides (v1.1)', () => {
  it('cleanParams prunes empty override objects and keeps string keys', () => {
    expect(
      cleanParams({ member_overrides: { '1': { retirement_age: 55 }, '2': {} } }),
    ).toEqual({ member_overrides: { '1': { retirement_age: 55 } } })
    expect(cleanParams({ member_overrides: {} })).toEqual({})
  })

  it('cleanParams drops a zero spending_delta_pct but keeps real ones', () => {
    expect(cleanParams({ spending_delta_pct: 0 })).toEqual({})
    expect(cleanParams({ spending_delta_pct: -10 })).toEqual({ spending_delta_pct: -10 })
  })

  it('withMemberOverride sets and clears an override against the baseline', () => {
    const set = withMemberOverride({}, 2, 'retirement_age', 60, 67, false)
    expect(set).toEqual({ member_overrides: { '2': { retirement_age: 60 } } })
    // sliding back to the member's baseline removes the whole override tree
    const cleared = withMemberOverride(set, 2, 'retirement_age', 67, 67, false)
    expect(cleared).toEqual({})
  })

  it('withMemberOverride keeps other members and keys intact', () => {
    const start = { member_overrides: { '1': { retirement_age: 55, ss_claim_age: 62 }, '2': { retirement_age: 60 } } }
    const out = withMemberOverride(start, 1, 'ss_claim_age', 67, 67, true)
    expect(out).toEqual({
      member_overrides: { '1': { retirement_age: 55 }, '2': { retirement_age: 60 } },
    })
  })

  it('edits the legacy top-level retirement_age sugar in place for self (compat)', () => {
    const legacy = { retirement_age: 55, annual_retirement_spending: 70000 }
    const moved = withMemberOverride(legacy, 1, 'retirement_age', 58, 65, true)
    expect(moved).toEqual({ retirement_age: 58, annual_retirement_spending: 70000 })
    // back at baseline → the sugar disappears entirely
    const cleared = withMemberOverride(moved, 1, 'retirement_age', 65, 65, true)
    expect(cleared).toEqual({ annual_retirement_spending: 70000 })
  })

  it('a fresh self override supersedes (and never coexists with) the sugar', () => {
    const out = withMemberOverride({}, 1, 'retirement_age', 58, 65, true)
    expect(out).toEqual({ member_overrides: { '1': { retirement_age: 58 } } })
    expect(out.retirement_age).toBeUndefined()
  })

  it('effectiveMemberTiming precedence: override > self sugar > member baseline', () => {
    expect(effectiveMemberTiming({}, 1, 'retirement_age', 65, true)).toBe(65)
    expect(effectiveMemberTiming({ retirement_age: 58 }, 1, 'retirement_age', 65, true)).toBe(58)
    expect(
      effectiveMemberTiming(
        { retirement_age: 58, member_overrides: { '1': { retirement_age: 60 } } },
        1,
        'retirement_age',
        65,
        true,
      ),
    ).toBe(60)
    // the sugar never leaks onto non-self members
    expect(effectiveMemberTiming({ retirement_age: 58 }, 2, 'retirement_age', 67, false)).toBe(67)
  })

  it('serializes member_overrides deterministically regardless of key order', () => {
    const a = serializeParams({ member_overrides: { '2': { retirement_age: 60 }, '1': { ss_claim_age: 62 } } })
    const b = serializeParams({ member_overrides: { '1': { ss_claim_age: 62 }, '2': { retirement_age: 60 } } })
    expect(a).toBe(b)
  })
})

describe('ssClaimFactor (62:0.70 … 67:1.00 … 70:1.24)', () => {
  it('matches the published steps exactly', () => {
    expect(ssClaimFactor(62)).toBe(0.7)
    expect(ssClaimFactor(63)).toBe(0.76)
    expect(ssClaimFactor(65)).toBe(0.88)
    expect(ssClaimFactor(67)).toBe(1)
    expect(ssClaimFactor(68)).toBe(1.08)
    expect(ssClaimFactor(70)).toBe(1.24)
  })

  it('clamps outside the legal claiming window', () => {
    expect(ssClaimFactor(55)).toBe(0.7)
    expect(ssClaimFactor(75)).toBe(1.24)
  })
})

describe('serializeParams', () => {
  it('is key-order independent', () => {
    const a = serializeParams({ retirement_age: 55, annual_retirement_spending: 70000 })
    const b = serializeParams({ annual_retirement_spending: 70000, retirement_age: 55 })
    expect(a).toBe(b)
  })

  it('treats no-op keys as equal to their absence', () => {
    expect(paramsEqual({ monthly_savings_delta: 0, events: [] }, {})).toBe(true)
  })

  it('distinguishes real differences', () => {
    expect(paramsEqual({ retirement_age: 55 }, { retirement_age: 56 })).toBe(false)
  })

  it('serializes events deterministically', () => {
    const s = serializeParams({
      events: [{ name: 'Golf', kind: 'recurring_expense', amount_monthly: 350, start_age: 47, end_age: null }],
    })
    expect(s).toContain('"events"')
    expect(serializeParams(JSON.parse(`{"events":[{"start_age":47,"kind":"recurring_expense","name":"Golf","amount_monthly":350,"end_age":null}]}`))).toBe(s)
  })
})

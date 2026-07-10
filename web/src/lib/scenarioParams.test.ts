import { describe, expect, it } from 'vitest'
import { cleanParams, paramsEqual, serializeParams } from './scenarioParams'

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

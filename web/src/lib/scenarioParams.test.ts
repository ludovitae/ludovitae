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

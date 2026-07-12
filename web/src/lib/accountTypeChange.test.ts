/** #30: consequence notes fire only for consequential type changes. */

import { describe, expect, it } from 'vitest'
import { typeChangeConsequences } from './accountTypeChange'

describe('typeChangeConsequences', () => {
  it('is silent for no-op and equivalent changes', () => {
    expect(typeChangeConsequences('checking', 'checking')).toEqual([])
    // checking↔savings: same analytics, RMD, sign and freshness behavior
    expect(typeChangeConsequences('checking', 'savings')).toEqual([])
    expect(typeChangeConsequences('mortgage', 'loan')).toEqual([])
    expect(typeChangeConsequences('property', 'vehicle')).toEqual([])
  })

  it('explains investment-activity exclusion both ways', () => {
    const into = typeChangeConsequences('checking', 'brokerage')
    expect(into.join(' ')).toMatch(/investment activity/i)
    expect(into.join(' ')).toMatch(/left out of spending/i)
    const outOf = typeChangeConsequences('brokerage', 'checking')
    expect(outOf.join(' ')).toMatch(/count in spending analytics again/i)
  })

  it('explains RMDs only for the retirement type', () => {
    expect(typeChangeConsequences('brokerage', 'retirement').join(' ')).toMatch(
      /required minimum distributions/i,
    )
    expect(typeChangeConsequences('retirement', 'hsa').join(' ')).toMatch(
      /no longer be drawn down/i,
    )
    // brokerage→hsa stays inside the investment family: no RMD note
    expect(typeChangeConsequences('brokerage', 'hsa')).toEqual([])
  })

  it('explains liability sign hints and net-worth side both ways', () => {
    const into = typeChangeConsequences('checking', 'credit_card')
    expect(into.join(' ')).toMatch(/count against your net worth/i)
    expect(into.join(' ')).toMatch(/sign check/i)
    const outOf = typeChangeConsequences('credit_card', 'checking')
    expect(outOf.join(' ')).toMatch(/toward your assets/i)
  })

  it('notes the freshness default when it flips, and keeps the setting', () => {
    const toProperty = typeChangeConsequences('checking', 'property')
    expect(toProperty.join(' ')).toMatch(/don’t track import freshness/i)
    expect(toProperty.join(' ')).toMatch(/current setting is kept/i)
    const toChecking = typeChangeConsequences('property', 'checking')
    expect(toChecking.join(' ')).toMatch(/usually track import freshness/i)
  })
})

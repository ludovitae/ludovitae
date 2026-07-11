import { describe, expect, it } from 'vitest'
import { payeeRulePattern } from './payee'

describe('payeeRulePattern', () => {
  it('strips processor prefixes', () => {
    expect(payeeRulePattern('SQ *BLUE STAR DONUTS')).toBe('blue star donuts')
    expect(payeeRulePattern('TST* PINE STATE BISCUITS')).toBe('pine state biscuits')
    expect(payeeRulePattern('PAYPAL *STEAMGAMES')).toBe('steamgames')
  })

  it('drops trailing reference codes but keeps merchant words', () => {
    expect(payeeRulePattern('AMZN Mktp US*2K47F0')).toBe('amzn mktp us')
    expect(payeeRulePattern('USPS PO 4038560204')).toBe('usps po')
    expect(payeeRulePattern('VENMO PAYMENT 8842')).toBe('venmo payment')
  })

  it('leaves plain names alone (lowercased)', () => {
    expect(payeeRulePattern('New Seasons Market')).toBe('new seasons market')
    expect(payeeRulePattern('Nostrana')).toBe('nostrana')
  })

  it('never returns empty for weird input', () => {
    expect(payeeRulePattern('  1234  ')).toBe('1234')
    expect(payeeRulePattern('***')).toBe('***')
  })
})

import { describe, expect, it } from 'vitest'
import { daysSince, freshnessMeta } from './freshness'

describe('daysSince', () => {
  it('counts days from an ISO datetime', () => {
    expect(daysSince('2026-07-01T09:15:00', '2026-07-11')).toBe(10)
    expect(daysSince('2026-07-11', '2026-07-11')).toBe(0)
  })
  it('never goes negative and tolerates junk', () => {
    expect(daysSince('2026-08-01', '2026-07-11')).toBe(0)
    expect(daysSince(null, '2026-07-11')).toBeNull()
    expect(daysSince('not-a-date', '2026-07-11')).toBeNull()
  })
})

describe('freshnessMeta', () => {
  it('maps all five states to label + tone', () => {
    expect(freshnessMeta('fresh', 3)).toMatchObject({ label: 'Fresh', tone: 'positive' })
    expect(freshnessMeta('aging', 27)).toMatchObject({ label: 'Aging', tone: 'warning' })
    expect(freshnessMeta('stale', 61)).toMatchObject({ label: 'Stale', tone: 'negative' })
    expect(freshnessMeta('never', null)).toMatchObject({ label: 'Never', tone: 'muted' })
    expect(freshnessMeta('off', null)).toMatchObject({ label: 'Off', tone: 'muted' })
  })

  it('puts days-since-import in the tooltip', () => {
    expect(freshnessMeta('stale', 61).tooltip).toBe('Last import 61 days ago')
    expect(freshnessMeta('fresh', 0).tooltip).toBe('Last import today')
    expect(freshnessMeta('fresh', 1).tooltip).toBe('Last import yesterday')
    expect(freshnessMeta('never', null).tooltip).toBe('No imports yet')
    expect(freshnessMeta('off', null).tooltip).toBe('Freshness not tracked for this account')
  })
})

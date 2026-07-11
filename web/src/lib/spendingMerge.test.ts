import { describe, expect, it } from 'vitest'
import type { ObservedCategory, SpendingCategory } from '@/api/types'
import { mergeObservedPlanned } from './spendingMerge'

function cat(id: number, name: string, amount: number, kind: SpendingCategory['kind'] = 'essential'): SpendingCategory {
  return { id, name, monthly_amount: amount, kind, annual_growth_pct: null }
}

function obs(category: string, avg: number, count = 10): ObservedCategory {
  return { category, monthly_avg: avg, txn_count: count }
}

describe('mergeObservedPlanned', () => {
  it('attaches observed averages to planned categories by name, case-insensitively', () => {
    const rows = mergeObservedPlanned([cat(1, 'Groceries', 950)], [obs('groceries', 902.5, 96)])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      categoryId: 1,
      name: 'Groceries',
      planned: 950,
      observed: 902.5,
      txnCount: 96,
    })
  })

  it('keeps planned-only rows with a null observed side', () => {
    const rows = mergeObservedPlanned([cat(1, 'Travel', 500)], [])
    expect(rows[0]).toMatchObject({ planned: 500, observed: null, txnCount: 0 })
  })

  it('appends observed-only rows (title-cased), sorted by average descending', () => {
    const rows = mergeObservedPlanned(
      [cat(1, 'Groceries', 950)],
      [obs('dining', 130), obs('auto', 160), obs('groceries', 900)],
    )
    expect(rows.map((r) => r.name)).toEqual(['Groceries', 'Auto', 'Dining'])
    expect(rows[1]).toMatchObject({ categoryId: null, kind: null, planned: null, observed: 160 })
  })

  it('preserves planned category order ahead of observed-only rows', () => {
    const rows = mergeObservedPlanned(
      [cat(1, 'Utilities', 320), cat(2, 'Groceries', 950, 'discretionary')],
      [obs('groceries', 900), obs('uncategorized', 50)],
    )
    expect(rows.map((r) => r.name)).toEqual(['Utilities', 'Groceries', 'Uncategorized'])
  })

  it('does not double-attach when two planned categories share a name', () => {
    const rows = mergeObservedPlanned(
      [cat(1, 'Misc', 100), cat(2, 'misc', 200)],
      [obs('MISC', 150)],
    )
    // first match wins; the duplicate keeps its planned side untouched
    expect(rows[0]).toMatchObject({ categoryId: 1, observed: 150 })
    expect(rows[1]).toMatchObject({ categoryId: 2, observed: null })
    expect(rows).toHaveLength(2)
  })

  it('handles the empty-everything case', () => {
    expect(mergeObservedPlanned([], [])).toEqual([])
  })
})

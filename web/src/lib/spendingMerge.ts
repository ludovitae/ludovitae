/** Observed-vs-planned merge for the Spending page. Pure and DOM-free.
 * Planned categories match observed transaction categories by normalized
 * name; unmatched rows survive on both sides so nothing silently vanishes. */

import type { ObservedCategory, SpendingCategory } from '@/api/types'

export interface MergedSpendingRow {
  /** stable render key */
  key: string
  name: string
  /** null → observed-only (no matching planned category yet) */
  categoryId: number | null
  kind: SpendingCategory['kind'] | null
  /** planned monthly amount; null → observed-only row */
  planned: number | null
  /** observed monthly average; null → no observed data for this category */
  observed: number | null
  txnCount: number
}

function norm(name: string): string {
  return name.trim().toLowerCase()
}

function titleCase(raw: string): string {
  const s = raw.trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Rows: planned categories in their given order (with observed averages
 * attached where names match, case-insensitively), then observed-only
 * categories sorted by observed average, largest first. */
export function mergeObservedPlanned(
  categories: SpendingCategory[],
  observed: ObservedCategory[],
): MergedSpendingRow[] {
  const rows: MergedSpendingRow[] = categories.map((c) => ({
    key: `cat-${c.id}`,
    name: c.name,
    categoryId: c.id,
    kind: c.kind,
    planned: c.monthly_amount,
    observed: null,
    txnCount: 0,
  }))
  const byName = new Map<string, MergedSpendingRow>()
  for (const r of rows) if (!byName.has(norm(r.name))) byName.set(norm(r.name), r)

  const extras: MergedSpendingRow[] = []
  for (const o of observed) {
    const match = byName.get(norm(o.category))
    if (match) {
      match.observed = o.monthly_avg
      match.txnCount = o.txn_count
    } else {
      extras.push({
        key: `obs-${norm(o.category)}`,
        name: titleCase(o.category),
        categoryId: null,
        kind: null,
        planned: null,
        observed: o.monthly_avg,
        txnCount: o.txn_count,
      })
    }
  }
  extras.sort((a, b) => (b.observed ?? 0) - (a.observed ?? 0))
  return [...rows, ...extras]
}

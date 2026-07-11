/** Transforms for the subscription radar (Spending → Recurring). Pure so the
 * grouping/sorting logic is unit-testable apart from the table markup. */

import type { RecurringCadence, RecurringCharge } from '@/api/types'

export interface RecurringGroups {
  /** the owner's forgotten-subscription hunter — shown as a callout first */
  forgotten: RecurringCharge[]
  /** active charges not in the forgotten group */
  active: RecurringCharge[]
  /** not seen within 1.5× cadence */
  lapsed: RecurringCharge[]
}

const byMonthlyDesc = (a: RecurringCharge, b: RecurringCharge) =>
  b.monthly_equivalent - a.monthly_equivalent

/** Split charges into forgotten / active / lapsed, each sorted by monthly
 * cost desc. `forgottenPayees` comes from /spending/hotspots
 * possibly_forgotten (server-decided membership; matching by payee). */
export function groupRecurring(
  charges: RecurringCharge[],
  forgottenPayees: ReadonlySet<string>,
): RecurringGroups {
  const forgotten: RecurringCharge[] = []
  const active: RecurringCharge[] = []
  const lapsed: RecurringCharge[] = []
  for (const c of charges) {
    if (!c.active) lapsed.push(c)
    else if (forgottenPayees.has(c.payee)) forgotten.push(c)
    else active.push(c)
  }
  forgotten.sort(byMonthlyDesc)
  active.sort(byMonthlyDesc)
  lapsed.sort(byMonthlyDesc)
  return { forgotten, active, lapsed }
}

/** Sum of monthly equivalents for a set of charges. */
export function monthlyTotal(charges: RecurringCharge[]): number {
  return Math.round(charges.reduce((s, c) => s + c.monthly_equivalent, 0) * 100) / 100
}

export const CADENCE_LABELS: Record<RecurringCadence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  annual: 'Annual',
}

/** Price-change badge copy: null when steady (no badge). */
export function priceChangeLabel(pct: number): string | null {
  if (pct === 0) return null
  const sign = pct > 0 ? '+' : '−'
  return `${sign}${Math.abs(pct).toFixed(1)}%`
}

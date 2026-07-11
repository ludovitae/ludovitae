/** Transforms for the subscription radar (Spending → Recurring). Pure so the
 * grouping/sorting logic is unit-testable apart from the table markup.
 *
 * Detection is by-the-letter (T-007), so a steady weekly grocery habit IS a
 * recurring charge. Per the amount_variability_pct ruling (2026-07-11) the UI
 * segments true subscriptions from spending habits so the radar isn't
 * polluted. A price HIKE inflates variability (Netflix's step change reports
 * ~6.6%), so subscription-likeness treats a step change as a price event,
 * not spending noise — but only when the change DWARFS the noise (≥ 2× the
 * variability): a jittery habit's last amount routinely lands ±5% off its
 * median, and that must not smuggle it into the subscriptions group. */

import type { RecurringCadence, RecurringCharge } from '@/api/types'

/** Ruling threshold: true subscriptions vary ≤ ~5% around their median. */
export const SUBSCRIPTION_MAX_VARIABILITY_PCT = 5

/** Show a price-change badge only for real repricing (matches the backend's
 * own price_increases threshold) — raw jitter is not a "price change". */
export const PRICE_CHANGE_MIN_PCT = 5

export function isSubscriptionLike(c: RecurringCharge): boolean {
  if (c.amount_variability_pct <= SUBSCRIPTION_MAX_VARIABILITY_PCT) return true
  // a real repricing is a STEP: big enough to badge and ≥ 2× the noise floor
  const change = Math.abs(c.price_change_pct)
  return change >= PRICE_CHANGE_MIN_PCT && change >= 2 * c.amount_variability_pct
}

export interface RecurringGroups {
  /** the owner's forgotten-subscription hunter — shown as a callout first */
  forgotten: RecurringCharge[]
  /** active, subscription-like (low variability or a clear repricing) */
  subscriptions: RecurringCharge[]
  /** active but variable — steady spending habits (weekly groceries etc.) */
  habits: RecurringCharge[]
  /** not seen within 1.5× cadence */
  lapsed: RecurringCharge[]
}

const byMonthlyDesc = (a: RecurringCharge, b: RecurringCharge) =>
  b.monthly_equivalent - a.monthly_equivalent

/** Split charges into forgotten / subscriptions / habits / lapsed, each
 * sorted by monthly cost desc. `forgottenPayees` comes from
 * /spending/hotspots possibly_forgotten (server-decided membership). */
export function groupRecurring(
  charges: RecurringCharge[],
  forgottenPayees: ReadonlySet<string>,
): RecurringGroups {
  const forgotten: RecurringCharge[] = []
  const subscriptions: RecurringCharge[] = []
  const habits: RecurringCharge[] = []
  const lapsed: RecurringCharge[] = []
  for (const c of charges) {
    if (!c.active) lapsed.push(c)
    else if (forgottenPayees.has(c.payee)) forgotten.push(c)
    else if (isSubscriptionLike(c)) subscriptions.push(c)
    else habits.push(c)
  }
  forgotten.sort(byMonthlyDesc)
  subscriptions.sort(byMonthlyDesc)
  habits.sort(byMonthlyDesc)
  lapsed.sort(byMonthlyDesc)
  return { forgotten, subscriptions, habits, lapsed }
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

/** Price-change badge copy: null below the badge threshold (the backend now
 * reports raw rounded values, so jitter must not badge — ruling 2026-07-11). */
export function priceChangeLabel(pct: number): string | null {
  if (Math.abs(pct) < PRICE_CHANGE_MIN_PCT) return null
  const sign = pct > 0 ? '+' : '−'
  return `${sign}${Math.abs(pct).toFixed(1)}%`
}

/** v1.2 spending analytics for the mock API — computed from db.transactions
 * on demand so pairing/categorizing in the UI is reflected immediately.
 * Every function here excludes transfer-paired transactions (contract rule).
 * Shapes mirror docs/API.md §"Spending analytics (v1.2)". */

import type {
  Account,
  Freshness,
  RecurringCadence,
  RecurringCharge,
  SpendingForecast,
  SpendingHotspots,
  SpendingSummary,
  Transaction,
} from '../types'
import * as db from './db'
import { todayISO } from '@/lib/format'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Spending rows: outflows, not transfer-paired. */
function outflows(): Transaction[] {
  return db.transactions.filter((t) => t.amount < 0 && t.transfer_pair_id === null)
}

const MS_DAY = 86_400_000

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / MS_DAY)
}

/** "YYYY-MM" for a date string. */
const monthOf = (date: string) => date.slice(0, 7)

/** Inclusive month keys between two dates. */
function monthKeys(fromISO: string, toISO: string): string[] {
  const out: string[] = []
  let [y, m] = [Number(fromISO.slice(0, 4)), Number(fromISO.slice(5, 7))]
  const end = monthOf(toISO)
  for (let i = 0; i < 600; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key === end) break
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

function isoMonthsAgoFirst(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/* ------------------------------- summary --------------------------------- */

export function spendingSummary(from?: string, to?: string): SpendingSummary {
  const f = from || isoMonthsAgoFirst(11)
  const t = to || todayISO()
  const months = monthKeys(f, t)
  const idx = new Map(months.map((m, i) => [m, i]))

  const byCat = new Map<string, number[]>()
  for (const txn of outflows()) {
    if (txn.date < f || txn.date > t) continue
    const i = idx.get(monthOf(txn.date))
    if (i === undefined) continue
    const cat = txn.category.trim() || 'uncategorized'
    let totals = byCat.get(cat)
    if (!totals) byCat.set(cat, (totals = months.map(() => 0)))
    totals[i]! += -txn.amount
  }

  const categories = [...byCat.entries()]
    .map(([category, raw]) => {
      const totals = raw.map(round2)
      return { category, totals, total: round2(totals.reduce((s, v) => s + v, 0)) }
    })
    .sort((a, b) => b.total - a.total)

  return {
    months,
    categories,
    grand_total: round2(categories.reduce((s, c) => s + c.total, 0)),
  }
}

/* ------------------------------ recurring --------------------------------- */

const CADENCE_DAYS: Record<RecurringCadence, number> = {
  weekly: 7,
  monthly: 30.44,
  annual: 365.25,
}

function cadenceFor(medianInterval: number): RecurringCadence | null {
  if (medianInterval >= 5 && medianInterval <= 9) return 'weekly'
  if (medianInterval >= 25 && medianInterval <= 36) return 'monthly'
  if (medianInterval >= 330 && medianInterval <= 400) return 'annual'
  return null
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Detection per contract: same normalized payee, ≥3 occurrences, regular
 * cadence (±5 days tolerance), price changes flagged, not disqualifying. */
export function detectRecurring(): RecurringCharge[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of outflows()) {
    const key = t.payee.trim().toLowerCase()
    const g = groups.get(key)
    if (g) g.push(t)
    else groups.set(key, [t])
  }

  const today = todayISO()
  const out: RecurringCharge[] = []
  for (const txns of groups.values()) {
    if (txns.length < 3) continue
    const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : 1))
    const intervals = sorted.slice(1).map((t, i) => daysBetween(sorted[i]!.date, t.date))
    const cadence = cadenceFor(median(intervals))
    if (!cadence) continue
    const nominal = CADENCE_DAYS[cadence]
    if (!intervals.every((d) => Math.abs(d - nominal) <= 5 + (cadence === 'annual' ? 10 : 0))) continue

    const amounts = sorted.map((t) => -t.amount)
    const typical = round2(median(amounts))
    const last = sorted[sorted.length - 1]!
    const lastAmount = round2(-last.amount)
    const changePct = typical > 0 ? Math.round(((lastAmount - typical) / typical) * 1000) / 10 : 0
    const monthlyEq =
      cadence === 'monthly' ? lastAmount : cadence === 'weekly' ? (lastAmount * 52) / 12 : lastAmount / 12

    out.push({
      payee: last.payee,
      category: last.category.trim() || 'uncategorized',
      cadence,
      typical_amount: typical,
      last_amount: lastAmount,
      price_change_pct: Math.abs(changePct) >= 1 ? changePct : 0,
      last_date: last.date,
      first_seen: sorted[0]!.date,
      occurrences: sorted.length,
      active: daysBetween(last.date, today) <= 1.5 * nominal,
      monthly_equivalent: round2(monthlyEq),
    })
  }
  return out.sort((a, b) => b.monthly_equivalent - a.monthly_equivalent)
}

/* ------------------------------- hotspots --------------------------------- */

export function hotspots(monthsRaw: number): SpendingHotspots {
  const months = Math.min(24, Math.max(2, Number.isFinite(monthsRaw) ? Math.round(monthsRaw) : 6))
  const recentFrom = isoMonthsAgoFirst(2) // trailing 3 calendar months incl. current
  const baseFrom = isoMonthsAgoFirst(2 + months)

  const recent = new Map<string, number>()
  const baseline = new Map<string, number>()
  const merchants = new Map<string, { total: number; count: number }>()

  for (const t of outflows()) {
    const cat = t.category.trim() || 'uncategorized'
    if (t.date >= recentFrom) {
      recent.set(cat, (recent.get(cat) ?? 0) - t.amount)
    } else if (t.date >= baseFrom) {
      baseline.set(cat, (baseline.get(cat) ?? 0) - t.amount)
    }
    if (t.date >= baseFrom) {
      const m = merchants.get(t.payee) ?? { total: 0, count: 0 }
      m.total += -t.amount
      m.count += 1
      merchants.set(t.payee, m)
    }
  }

  const category_spikes = [...recent.entries()]
    .map(([category, total]) => {
      const recentAvg = total / 3
      const baseAvg = (baseline.get(category) ?? 0) / months
      return {
        category,
        recent_monthly_avg: round2(recentAvg),
        baseline_monthly_avg: round2(baseAvg),
        delta_pct: baseAvg > 0 ? Math.round(((recentAvg - baseAvg) / baseAvg) * 1000) / 10 : 0,
      }
    })
    .filter((s) => s.baseline_monthly_avg >= 25 && Math.abs(s.delta_pct) >= 10)
    .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))

  const top_merchants = [...merchants.entries()]
    .map(([payee, { total, count }]) => ({
      payee,
      monthly_avg: round2(total / (months + 3)),
      txn_count: count,
    }))
    .sort((a, b) => b.monthly_avg - a.monthly_avg)
    .slice(0, 8)

  const recurring = detectRecurring()
  const price_increases = recurring.filter((r) => r.price_change_pct >= 5)
  const today = todayISO()
  // Contract: active, low-variance, running ≥ 12 months. The mock adds a
  // small-charge cap (≤ $100/mo) so fixed bills like the mortgage don't
  // read as "forgotten" — flagged for T-007 alignment.
  const possibly_forgotten = recurring.filter(
    (r) =>
      r.active &&
      r.price_change_pct === 0 &&
      Math.abs(r.last_amount - r.typical_amount) < 0.005 &&
      daysBetween(r.first_seen, today) >= 365 &&
      r.monthly_equivalent <= 100,
  )

  return { category_spikes, top_merchants, price_increases, possibly_forgotten }
}

/* ------------------------------- forecast --------------------------------- */

export function forecast(monthsRaw: number): SpendingForecast {
  const months = Math.min(24, Math.max(1, Number.isFinite(monthsRaw) ? Math.round(monthsRaw) : 12))
  const labels: string[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = 1; i <= months; i++) {
    const m = new Date(d)
    m.setMonth(d.getMonth() + i)
    labels.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }

  const recurring = detectRecurring().filter((r) => r.active)
  const recurringMonthly = round2(recurring.reduce((s, r) => s + r.monthly_equivalent, 0))
  const recurringPayees = new Set(recurring.map((r) => r.payee.trim().toLowerCase()))

  // variable = trailing-6-month average of non-recurring outflows per category
  const from = isoMonthsAgoFirst(5)
  const byCat = new Map<string, number>()
  for (const t of outflows()) {
    if (t.date < from) continue
    if (recurringPayees.has(t.payee.trim().toLowerCase())) continue
    const cat = t.category.trim() || 'uncategorized'
    byCat.set(cat, (byCat.get(cat) ?? 0) - t.amount)
  }
  const variable_by_category = [...byCat.entries()]
    .map(([category, total]) => ({
      category,
      totals: labels.map(() => round2(total / 6)),
    }))
    .sort((a, b) => (b.totals[0] ?? 0) - (a.totals[0] ?? 0))

  const variableMonthly = round2(variable_by_category.reduce((s, c) => s + (c.totals[0] ?? 0), 0))

  return {
    months: labels,
    recurring: labels.map(() => recurringMonthly),
    variable_by_category,
    total: labels.map(() => round2(recurringMonthly + variableMonthly)),
  }
}

/* ------------------------------ freshness --------------------------------- */

/** Server-computed freshness per the v1.2 contract: threshold = override ?? 35
 * days; aging at 2/3 of threshold; `never` = no imports and no transactions;
 * `off` when the account doesn't track freshness. */
export function freshnessOf(a: Account): { freshness: Freshness; days_since_import: number | null } {
  if (!a.track_freshness) return { freshness: 'off', days_since_import: null }
  const ref = a.last_import_at?.slice(0, 10) ?? a.newest_transaction_date
  if (!ref) return { freshness: 'never', days_since_import: null }
  const days = Math.max(0, daysBetween(ref, todayISO()))
  const threshold = a.staleness_days ?? 35
  const freshness: Freshness = days >= threshold ? 'stale' : days >= (threshold * 2) / 3 ? 'aging' : 'fresh'
  return { freshness, days_since_import: days }
}

/* ------------------------- heuristic suggestions -------------------------- */

const HEURISTICS: [RegExp, string, number][] = [
  [/donut|biscuit|coffee|espresso|roaster|restaurant|pizza|taco|tst\*/i, 'dining', 0.74],
  [/amzn|amazon|ikea|target|costco|hardware/i, 'shopping', 0.66],
  [/grocer|market|seasons|safeway|kroger/i, 'groceries', 0.78],
  [/steam|playstation|nintendo|cinema|theater/i, 'entertainment', 0.62],
  [/pge|electric|water dept|nw natural|comcast|xfinity/i, 'utilities', 0.8],
  [/chevron|shell oil|76 |gas station/i, 'auto', 0.7],
  [/gym|fitness|yoga|clinic|pharmacy/i, 'health', 0.68],
]

export function suggestCategories(payees: string[]) {
  const suggestions: { payee: string; category: string; confidence: number }[] = []
  for (const payee of payees) {
    for (const [re, category, confidence] of HEURISTICS) {
      if (re.test(payee)) {
        suggestions.push({ payee, category, confidence })
        break
      }
    }
  }
  return { suggestions, source: 'heuristic' as const }
}

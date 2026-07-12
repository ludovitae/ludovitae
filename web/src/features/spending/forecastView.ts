/** #29 forecast view model — pure joins and month-key labels shared by the
 * explain strip and the per-month breakdown. Amounts come straight from the
 * /spending/forecast and /spending/recurring responses; the only client-side
 * derivations are calendar LABELS (see ForecastExplain.tsx header). */

import type { RecurringCharge, SpendingForecast } from '@/api/types'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/* --------------------------- month-key helpers ---------------------------- */
/* All operate on "YYYY-MM" keys — string arithmetic, no Date parsing (UTC
 * pitfalls) and no amounts involved. */

export function shiftMonthKey(key: string, delta: number): string {
  const y = Number(key.slice(0, 4))
  const m0 = Number(key.slice(5, 7)) - 1 + delta
  const y2 = y + Math.floor(m0 / 12)
  const m2 = ((m0 % 12) + 12) % 12
  return `${y2}-${String(m2 + 1).padStart(2, '0')}`
}

/** "2026-08" → "Aug" (with ’YY on January, so year rollovers stay legible). */
export function shortMonthKey(key: string): string {
  const m = MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? key
  return m === 'Jan' ? `${m} ’${key.slice(2, 4)}` : m
}

/** "2026-08" → "August 2026". */
export function longMonthKey(key: string): string {
  return `${MONTHS_LONG[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`
}

/** Calendar month name of a date string: "2026-03-20" → "March". */
export function monthNameOf(dateISO: string): string {
  return MONTHS_LONG[Number(dateISO.slice(5, 7)) - 1] ?? dateISO
}

/** First day of a month key, spelled out: "2026-01" → "January 1, 2026". */
export function firstDayLabel(key: string): string {
  return `${MONTHS_LONG[Number(key.slice(5, 7)) - 1]} 1, ${key.slice(0, 4)}`
}

/** Last day of a month key, spelled out: "2026-06" → "June 30, 2026". */
export function lastDayLabel(key: string): string {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7))
  const days = new Date(y, m, 0).getDate()
  return `${MONTHS_LONG[m - 1]} ${days}, ${y}`
}

/* ------------------------------ the join ---------------------------------- */

export interface ForecastMonthView {
  key: string
  /** server's number for the month — components below explain it */
  recurringTotal: number
  /** server's total minus server's recurring — never re-summed from parts */
  variableTotal: number
  total: number
  /** active annual charges whose anniversary month is this calendar month */
  annuals: RecurringCharge[]
}

export interface ForecastView {
  /** active non-annual charges — projected at monthly_equivalent every month */
  steady: RecurringCharge[]
  /** active annual charges — lump in their anniversary month */
  annual: RecurringCharge[]
  /** inactive charges — excluded from the projection entirely */
  lapsed: RecurringCharge[]
  months: ForecastMonthView[]
  /** the current (partial) month — the one before months[0] */
  currentKey: string
  /** 6-full-month variable lookback window */
  windowFromKey: string
  windowToKey: string
}

export const round2 = (n: number) => Math.round(n * 100) / 100

export function buildForecastView(forecast: SpendingForecast, charges: RecurringCharge[]): ForecastView {
  const active = charges.filter((c) => c.active)
  const steady = active.filter((c) => c.cadence !== 'annual')
  const annual = active.filter((c) => c.cadence === 'annual')
  const lapsed = charges.filter((c) => !c.active)

  const months = forecast.months.map((key, i) => {
    const recurringTotal = forecast.recurring[i] ?? 0
    const total = forecast.total[i] ?? 0
    return {
      key,
      recurringTotal,
      total,
      variableTotal: round2(Math.max(0, total - recurringTotal)),
      annuals: annual.filter((c) => c.last_date.slice(5, 7) === key.slice(5, 7)),
    }
  })

  const first = forecast.months[0] ?? ''
  return {
    steady,
    annual,
    lapsed,
    months,
    currentKey: first ? shiftMonthKey(first, -1) : '',
    windowFromKey: first ? shiftMonthKey(first, -7) : '',
    windowToKey: first ? shiftMonthKey(first, -2) : '',
  }
}


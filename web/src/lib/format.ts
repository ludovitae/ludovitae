/** Shared money/date formatting. DESIGN.md: one util, compact on charts,
 * full elsewhere, tabular numerals via the `.num` utility class. */

const full = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const fullCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Full form: $1,234,568 (or $1,234.56 with `cents`). */
export function formatMoney(value: number, opts?: { cents?: boolean }): string {
  if (!Number.isFinite(value)) return '—'
  return opts?.cents ? fullCents.format(value) : full.format(value)
}

/** Compact chart form: $1.4M, $812K, -$3.2K, $950. */
export function formatMoneyCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9)}B`
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`
  return `${sign}$${Math.round(abs)}`
}

function trim(n: number): string {
  const s = n >= 100 ? Math.round(n).toString() : n.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Signed delta: +$12,300 / -$4,100. */
export function formatMoneyDelta(value: number): string {
  const base = formatMoney(Math.abs(value))
  return value >= 0 ? `+${base}` : `-${base}`
}

export function formatPct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** 0.87 → "87%". */
export function formatProbability(p: number): string {
  if (!Number.isFinite(p)) return '—'
  return `${Math.round(p * 100)}%`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2032-06-01" → "Jun 1, 2032". Invalid → "—". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return '—'
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return '—'
  return `${month} ${Number(m[3])}, ${m[1]}`
}

/** "2032-06-01" → "Jun 2032". */
export function formatMonthYear(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return '—'
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return '—'
  return `${month} ${m[1]}`
}

/** Today as YYYY-MM-DD (local). */
export function todayISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

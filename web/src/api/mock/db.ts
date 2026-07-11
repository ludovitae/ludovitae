/** In-memory demo household for VITE_MOCK=1. Three members (46 / 43 / 14),
 * ~$908k net worth. State resets on reload; auth persists in localStorage. */

import type {
  Account,
  BalanceSnapshot,
  CategoryRule,
  Flow,
  Goal,
  HouseholdMember,
  ImportPreset,
  Profile,
  Scenario,
  Settings,
  SpendingProfile,
  Transaction,
} from '../types'
import { FRESHNESS_TRACKED_TYPES, LIABILITY_TYPES } from '../types'
import { mulberry32, gaussian } from './rng'
import { todayISO } from '@/lib/format'

/** v1.1 slim profile — person-level fields live on household members. */
export const profile: Profile = {
  annual_retirement_spending: 80000,
  inflation_pct: 2.5,
  effective_tax_rate_pct: 18,
}

export const household: HouseholdMember[] = [
  {
    id: 1, name: 'Brian', role: 'self', birth_year: 1980, life_expectancy: 92,
    retirement_age: 65, ss_monthly_at_fra: 2200, ss_claim_age: 67, notes: '',
  },
  {
    id: 2, name: 'Dana', role: 'partner', birth_year: 1983, life_expectancy: 94,
    retirement_age: 67, ss_monthly_at_fra: 1600, ss_claim_age: 67, notes: '',
  },
  {
    id: 3, name: 'Wren', role: 'child', birth_year: 2012, life_expectancy: 95,
    retirement_age: null, ss_monthly_at_fra: null, ss_claim_age: null,
    notes: 'college fund lives under Goals',
  },
]

const today = todayISO()

/** ISO date `n` days before today (local). */
function daysAgoISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** v1.2 contract default: freshness is tracked for cash/card/investment types. */
export const TRACK_FRESHNESS_DEFAULT = FRESHNESS_TRACKED_TYPES

export const accounts: Account[] = [
  // freshness spread on purpose: fresh / aging / stale / never / off all demo.
  imp(acc(1, 'Everyday Checking', 'checking', 'First Tech CU', 12400, null, 'cash', null), 3),
  imp(acc(2, 'High-Yield Savings', 'savings', 'Ally', 42000, null, 'cash', null), 27),
  imp(acc(3, 'Vanguard Brokerage', 'brokerage', 'Vanguard', 178000, null, 'stocks', null), 61),
  acc(4, '401(k)', 'retirement', 'Fidelity', 295000, null, 'mixed', 1), // never imported
  acc(5, 'Roth IRA', 'retirement', 'Vanguard', 88000, null, 'stocks', 1),
  acc(6, 'HSA', 'hsa', 'Fidelity', 24500, null, 'stocks', 2),
  acc(7, 'House', 'property', '—', 480000, 3.0, null, null, 'Zestimate, sanity-checked'),
  acc(8, 'Subaru Outback', 'vehicle', '—', 14000, -8.0, null, null),
  acc(9, 'Mortgage', 'mortgage', 'Rocket', 315000, null, null, null, '2.9% 30yr, 2021'),
  acc(10, 'Car Loan', 'loan', 'First Tech CU', 6500, null, null, null),
  acc(11, '403(b)', 'retirement', 'TIAA', 96000, null, 'mixed', 2),
  imp(acc(12, 'Sapphire Card', 'credit_card', 'Chase', 1850, null, null, null), 2),
]

function acc(
  id: number,
  name: string,
  type: Account['type'],
  institution: string,
  balance: number,
  growth: number | null,
  assetClass: Account['asset_class'],
  memberId: number | null,
  notes = '',
): Account {
  return {
    id,
    name,
    type,
    institution,
    balance,
    growth_rate_pct: growth,
    asset_class: assetClass,
    member_id: memberId,
    include_in_net_worth: true,
    notes,
    created_at: today,
    last_import_at: null,
    newest_transaction_date: null,
    staleness_days: null,
    track_freshness: TRACK_FRESHNESS_DEFAULT.includes(type),
    freshness: 'never', // storage default; served value is computed per request
  }
}

/** Mark an account as last imported `daysAgo` days ago. */
function imp(a: Account, daysAgo: number): Account {
  a.last_import_at = `${daysAgoISO(daysAgo)}T09:15:00`
  a.newest_transaction_date = daysAgoISO(daysAgo + 1)
  return a
}

export const flows: Flow[] = [
  flow(1, 'Salary — Brian', 'income', 9800, 3.0, 'salary', 1),
  flow(2, 'Salary — Dana', 'income', 6200, 3.0, 'salary', 2),
  // Everyday spending lives in the v1.1 spending categories; the mortgage
  // stays a flow (fixed payment with an end date, not an inflating category).
  { ...flow(3, 'Mortgage payment', 'expense', 2350, 0, 'housing', null), end_date: '2041-08-01', ends_at_retirement: false },
  { ...flow(5, '401(k) contributions', 'contribution', 1800, 0, 'retirement', 1), account_id: 4 },
  { ...flow(6, 'Roth IRA', 'contribution', 580, 0, 'retirement', 1), account_id: 5 },
  { ...flow(7, 'HSA', 'contribution', 350, 0, 'health', 2), account_id: 6 },
  { ...flow(8, 'Brokerage auto-invest', 'contribution', 1000, 0, 'investing', null), account_id: 3 },
]

function flow(
  id: number,
  name: string,
  kind: Flow['kind'],
  monthly: number,
  growth: number,
  category: string,
  memberId: number | null,
): Flow {
  return {
    id,
    name,
    kind,
    amount_monthly: monthly,
    annual_growth_pct: growth,
    start_date: null,
    end_date: null,
    account_id: null,
    category,
    member_id: memberId,
    ends_at_retirement: kind !== 'expense',
  }
}

export const spendingProfile: SpendingProfile = {
  categories: [
    { id: 1, name: 'Groceries', monthly_amount: 950, kind: 'essential', annual_growth_pct: null },
    { id: 2, name: 'Utilities', monthly_amount: 320, kind: 'essential', annual_growth_pct: null },
    { id: 3, name: 'Insurance', monthly_amount: 380, kind: 'essential', annual_growth_pct: null },
    { id: 4, name: 'Transportation', monthly_amount: 420, kind: 'essential', annual_growth_pct: null },
    { id: 5, name: 'Healthcare', monthly_amount: 350, kind: 'essential', annual_growth_pct: 5 },
    { id: 6, name: 'Kids & school', monthly_amount: 600, kind: 'essential', annual_growth_pct: null },
    { id: 7, name: 'Dining out', monthly_amount: 520, kind: 'discretionary', annual_growth_pct: null },
    { id: 8, name: 'Travel', monthly_amount: 500, kind: 'discretionary', annual_growth_pct: null },
    { id: 9, name: 'Subscriptions', monthly_amount: 85, kind: 'discretionary', annual_growth_pct: null },
    { id: 10, name: 'Everything else', monthly_amount: 900, kind: 'discretionary', annual_growth_pct: null },
  ],
  monthly_savings_target: 1500,
}

export const goals: Goal[] = [
  { id: 1, name: 'Sailboat', emoji: '⛵', target_amount: 60000, target_date: '2032-06-01', priority: 2, funded_amount: 5000, notes: 'the dream' },
  { id: 2, name: 'College fund top-up', emoji: '🎓', target_amount: 40000, target_date: '2029-09-01', priority: 1, funded_amount: 22000, notes: '' },
  { id: 3, name: 'Kitchen remodel', emoji: '🍳', target_amount: 35000, target_date: '2027-05-01', priority: 2, funded_amount: 12000, notes: 'counters + range' },
  { id: 4, name: 'Japan, slowly', emoji: '🗻', target_amount: 9000, target_date: '2027-10-01', priority: 3, funded_amount: 3200, notes: '3 weeks, shoulder season' },
]

export const scenarios: Scenario[] = [
  {
    id: 1,
    name: 'Retire at 55',
    description: 'Out at 55, trimmed spending, same savings rate.',
    is_baseline: false,
    params: { retirement_age: 55, annual_retirement_spending: 70000 },
  },
  {
    id: 2,
    name: 'Coast mode',
    description: 'Ease off saving now, pick up golf, retire on time.',
    is_baseline: false,
    params: {
      monthly_savings_delta: -1500,
      events: [
        { name: 'Take up golf', kind: 'recurring_expense', amount_monthly: 350, start_age: 47, end_age: null },
      ],
    },
  },
]

export const settings: Settings = { theme: 'fintech', reduce_motion: false }

/* ------------------------- balance history ------------------------------ */

function isoMonthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-01`
}

/** Seeded random-walk history, walking back from the current balance. */
function genHistory(account: Account, months: number, drift: number, vol: number): BalanceSnapshot[] {
  const rng = mulberry32(account.id * 1013 + 7)
  const out: BalanceSnapshot[] = []
  let v = account.balance
  out.push({ date: today, amount: account.balance })
  for (let m = 1; m <= months; m++) {
    v = v / (1 + drift / 12 + gaussian(rng) * vol)
    out.push({ date: isoMonthsAgo(m), amount: Math.round(v) })
  }
  return out.reverse()
}

export const balances = new Map<number, BalanceSnapshot[]>()
for (const a of accounts) {
  if (a.type === 'checking') balances.set(a.id, genHistory(a, 36, 0.01, 0.05))
  else if (a.type === 'savings') balances.set(a.id, genHistory(a, 36, 0.1, 0.01))
  else if (LIABILITY_TYPES.includes(a.type)) balances.set(a.id, genHistory(a, 36, -0.028, 0.001))
  else if (a.type === 'property') balances.set(a.id, genHistory(a, 36, 0.03, 0.002))
  else if (a.type === 'vehicle') balances.set(a.id, genHistory(a, 36, -0.08, 0.002))
  else balances.set(a.id, genHistory(a, 36, 0.09, 0.028))
}

/** Net-worth history summed across account snapshots (monthly, 36 pts). */
export function netWorthHistory(): { date: string; net_worth: number }[] {
  const out: { date: string; net_worth: number }[] = []
  for (let m = 35; m >= 0; m--) {
    const date = m === 0 ? today : isoMonthsAgo(m)
    let nw = 0
    for (const a of accounts) {
      if (!a.include_in_net_worth) continue
      const snaps = balances.get(a.id) ?? []
      // latest snapshot at or before `date`
      let amt = snaps[0]?.amount ?? a.balance
      for (const s of snaps) if (s.date <= date) amt = s.amount
      nw += LIABILITY_TYPES.includes(a.type) ? -amt : amt
    }
    out.push({ date, net_worth: Math.round(nw) })
  }
  return out
}

/* --------------------------- transactions ------------------------------- */
/* v1.2 demo ledger. Checking (1) carries salary, mortgage, groceries,
 * utilities, gas. The Sapphire Card (12) carries dining/shopping plus the
 * fixed-day subscriptions the radar should find — including one price hike
 * (Netflix) and long-running flat charges for the "possibly forgotten" group.
 * Monthly checking→card payments are auto-paired transfers (shared
 * transfer_pair_id) and must vanish from every analytics view. */

// payee, category, typical amount, monthly frequency, account
const VARIABLE_PAYEES: [string, string, number, number, number][] = [
  ['New Seasons Market', 'groceries', -142, 5, 1],
  ['Fred Meyer', 'groceries', -87, 3, 1],
  ['PGE', 'utilities', -128, 1, 1],
  ['NW Natural', 'utilities', -64, 1, 1],
  ['Comcast', 'utilities', -89, 1, 1],
  ['Chevron', 'auto', -52, 3, 1],
  ['Ristretto Roasters', 'dining', -14, 6, 12],
  ['Nostrana', 'dining', -118, 1, 12],
  ['REI', 'shopping', -95, 0.5, 12],
  ['Powell’s Books', 'shopping', -38, 1, 12],
]

// payee, category, amount(s), fixed day of month, months-ago range [from, to]
interface SubSpec {
  payee: string
  category: string
  day: number
  /** amount as a function of months-ago, so price hikes are expressible */
  amount: (monthsAgo: number) => number
  fromMonthsAgo: number
  toMonthsAgo: number
}

const CARD_SUBS: SubSpec[] = [
  // The price hike: 15.49 through month 6, 17.99 since (+16.1%).
  { payee: 'Netflix', category: 'subscriptions', day: 28, amount: (m) => (m >= 6 ? 15.49 : 17.99), fromMonthsAgo: 23, toMonthsAgo: 0 },
  // Started 8 months ago — active but too young for "possibly forgotten".
  { payee: 'Spotify', category: 'subscriptions', day: 6, amount: () => 11.99, fromMonthsAgo: 7, toMonthsAgo: 0 },
  // The forgotten ones: flat price, running well past 12 months.
  { payee: 'Apex Gym', category: 'health', day: 3, amount: () => 34, fromMonthsAgo: 23, toMonthsAgo: 0 },
  { payee: 'CloudVault Storage', category: 'subscriptions', day: 12, amount: () => 2.99, fromMonthsAgo: 19, toMonthsAgo: 0 },
  // Lapsed: cancelled ~5 months ago, shows in the inactive group.
  { payee: 'HBO Max', category: 'subscriptions', day: 15, amount: () => 15.99, fromMonthsAgo: 23, toMonthsAgo: 5 },
  // Card interest is REAL spending per the credit-card ruling.
  { payee: 'Purchase Interest Charge', category: 'interest-fees', day: 27, amount: () => 23.5, fromMonthsAgo: 4, toMonthsAgo: 0 },
]

// Uncategorized imports for the review queue (source: none, category "").
const UNCATEGORIZED: [string, number, number, number][] = [
  // payee, amount, days ago, account
  ['SQ *BLUE STAR DONUTS', -12.5, 4, 12],
  ['TST* PINE STATE BISCUITS', -28.75, 6, 12],
  ['AMZN Mktp US*2K47F0', -63.18, 8, 12],
  ['PAYPAL *STEAMGAMES', -29.99, 11, 12],
  ['IKEA PORTLAND', -214.32, 13, 12],
  ['SQ *BLUE STAR DONUTS', -9.25, 17, 12],
  ['VENMO PAYMENT 8842', -45, 19, 1],
  ['USPS PO 4038560204', -11.6, 22, 1],
  ['TST* PINE STATE BISCUITS', -31.4, 26, 12],
  ['AMZN Mktp US*9Q31Z8', -18.99, 33, 12],
  ['ST JOHNS ACE HARDWARE', -37.86, 41, 1],
  ['SQ *BLUE STAR DONUTS', -14, 47, 12],
]

function monthISO(monthsAgo: number, day: number): string {
  const base = new Date()
  base.setDate(1)
  base.setMonth(base.getMonth() - monthsAgo)
  const y = base.getFullYear()
  const mo = base.getMonth() + 1
  return `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`
}

// 24 months of history so the 3/6/12/24-month windows all have data.
export const transactions: Transaction[] = (() => {
  const rng = mulberry32(20260710)
  const out: Transaction[] = []
  let id = 1
  const push = (
    account_id: number,
    date: string,
    amount: number,
    payee: string,
    category: string,
    source: Transaction['category_source'] = 'rule',
    transfer_pair_id: number | null = null,
  ) => {
    if (date > today) return // a ledger never holds future transactions
    out.push({
      id: id++,
      account_id,
      date,
      amount: Math.round(amount * 100) / 100,
      payee,
      category,
      transfer_pair_id,
      category_source: category === '' ? 'none' : source,
    })
  }

  for (let m = 23; m >= 0; m--) {
    const iso = (day: number) => monthISO(m, day)
    // paychecks on the 1st and 15th
    push(1, iso(1), 4900, 'ACME Corp Payroll', 'salary')
    push(1, iso(15), 4900, 'ACME Corp Payroll', 'salary')
    push(1, iso(3), 3100, 'Evergreen Health Payroll', 'salary')
    push(1, iso(5), -2350, 'Rocket Mortgage', 'housing')

    // variable spending; dining runs hot in the last 3 months (hotspot demo)
    for (const [payee, category, amt, freq, account] of VARIABLE_PAYEES) {
      const hot = category === 'dining' && m < 3
      const effFreq = hot ? freq + 1 : freq
      const n = Math.floor(effFreq) + (rng() < effFreq % 1 ? 1 : 0)
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rng() * 27)
        const jitter = (1 + (rng() - 0.5) * 0.3) * (hot ? 1.35 : 1)
        push(account, iso(day), amt * jitter, payee, category, 'heuristic')
      }
    }

    // fixed-day subscriptions on the card
    for (const s of CARD_SUBS) {
      if (m > s.fromMonthsAgo || m < s.toMonthsAgo) continue
      push(12, iso(s.day), -s.amount(m), s.payee, s.category)
    }

    // checking→card payment, auto-paired on import (exact amount, 1 day
    // apart). Both legs or neither — never an orphaned pair id.
    const payment = Math.round((1250 + rng() * 450) * 100) / 100
    const pairId = 9000 + m
    if (iso(21) <= today) {
      push(1, iso(20), -payment, 'Payment to Sapphire Card', '', 'none', pairId)
      push(12, iso(21), payment, 'Payment Thank You - Web', '', 'none', pairId)
    }
  }

  // Amazon Prime — annual cadence needs 3 occurrences to be detected.
  for (const m of [25, 13, 1]) push(12, monthISO(m, 20), -139, 'Amazon Prime', 'subscriptions')

  // Weekly spending HABIT (not a subscription): steady cadence, jittered
  // amounts (variability > 5%) — demos the radar's subscriptions-vs-habits
  // segmentation from the amount_variability_pct ruling.
  for (let w = 0; w < 104; w++) {
    const jitter = 1 + (rng() - 0.5) * 0.36
    push(1, daysAgoISO(7 * w + 2), -(62 * jitter), 'Green Basket Farm Share', 'groceries', 'heuristic')
  }

  // uncategorized review-queue rows
  for (const [payee, amount, ago, account] of UNCATEGORIZED)
    push(account, daysAgoISO(ago), amount, payee, '')

  // near-miss transfer candidates (NOT paired):
  // (a) exact amount but 6 days apart — outside the ±4 auto-pair window
  push(1, daysAgoISO(14), -500, 'Online Transfer to Ally Savings', '')
  push(2, daysAgoISO(8), 500, 'Transfer from First Tech CU', '')
  // (b) same day but transposed cents on one leg
  push(1, daysAgoISO(5), -1389.42, 'Sapphire Card Payment', '')
  push(12, daysAgoISO(5), 1389.24, 'Payment Thank You - Web', '')

  return out.sort((a, b) => (a.date < b.date ? 1 : -1))
})()

/** Near-miss transfer candidates for the review queue: transaction id pairs
 * with a match score, resolved to live rows by the handler (pairing or
 * categorizing a leg removes the candidate). */
export const transferCandidates: { txn_ids: [number, number]; score: number }[] = (() => {
  const find = (payee: string, amount: number) =>
    transactions.find((t) => t.payee === payee && t.amount === amount && t.transfer_pair_id === null)
  const pairs: [string, number, string, number, number][] = [
    ['Online Transfer to Ally Savings', -500, 'Transfer from First Tech CU', 500, 0.58],
    ['Sapphire Card Payment', -1389.42, 'Payment Thank You - Web', 1389.24, 0.86],
  ]
  const out: { txn_ids: [number, number]; score: number }[] = []
  for (const [pa, aa, pb, ab, score] of pairs) {
    const a = find(pa, aa)
    const b = find(pb, ab)
    if (a && b) out.push({ txn_ids: [a.id, b.id], score })
  }
  return out
})()

/** Tombstones (ruling 2026-07-11): dismissed candidates and unpaired pairs
 * never auto-resurface. Key = sorted "a:b" transaction-id pair. Manual
 * POST /transfers/pair clears the tombstone. */
export const transferTombstones = new Set<string>()

export function tombstoneKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/* ----------------------- category rules (v1.2) --------------------------- */

export const rules: CategoryRule[] = [
  { id: 1, pattern: 'new seasons', match: 'contains', field: 'payee', category: 'groceries', priority: 1 },
  { id: 2, pattern: 'netflix', match: 'contains', field: 'payee', category: 'subscriptions', priority: 2 },
  { id: 3, pattern: 'pge', match: 'contains', field: 'payee', category: 'utilities', priority: 3 },
]

/* ------------------- import presets (v1.2.2, T-009) ---------------------- */
/* Saved column mappings keyed by header fingerprint. #26: the built-in
 * institution presets ship pre-seeded (mirroring migration 0007); user
 * presets append after them. */

/** Mock header fingerprint (v1.2.2, T-009). The real server uses sha256 of
 * the lowercased, sorted, comma-joined headers; the mock only needs the same
 * *identity* semantics, so a cheap deterministic hash of that material. */
export function fingerprintOf(columns: string[]): string {
  const material = columns.map((c) => c.trim().toLowerCase()).sort().join(',')
  return fnv(material)
}

/** #26: mock stand-in for the server's sha256 external-account hash. */
export function externalIdHash(raw: string): string {
  return fnv(`ext:${raw.trim()}`)
}

function fnv(material: string): string {
  let h = 2166136261
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** #26: hashed external-account links (hash → account id). The server
 * stores these on the account row; a side map keeps the mock simple. */
export const externalLinks = new Map<string, number>()

const BUILTIN_PRESET_SPECS: { name: string; columns: string[]; mapping: ImportPreset['mapping']; flip_signs: boolean }[] = [
  {
    name: 'Fidelity — Accounts History',
    columns: ['Run Date', 'Account', 'Account Number', 'Action', 'Symbol', 'Description', 'Type', 'Exchange Quantity', 'Exchange Currency', 'Currency', 'Price', 'Quantity', 'Exchange Rate', 'Commission', 'Fees', 'Accrued Interest', 'Amount', 'Settlement Date'],
    mapping: { date: 'Run Date', amount: 'Amount', payee: 'Action', account_column: 'Account', account_id_column: 'Account Number' },
    flip_signs: false,
  },
  {
    name: 'American Express — Activity',
    columns: ['Date', 'Description', 'Card Member', 'Account #', 'Amount', 'Extended Details', 'Appears On Your Statement As', 'Address', 'City/State', 'Zip Code', 'Country', 'Reference', 'Category'],
    mapping: { date: 'Date', amount: 'Amount', payee: 'Description', category: 'Category', account_id_column: 'Account #' },
    flip_signs: true,
  },
  {
    name: 'Citi — Credit Card',
    columns: ['Status', 'Date', 'Description', 'Debit', 'Credit', 'Member Name'],
    mapping: { date: 'Date', debit: 'Debit', credit: 'Credit', payee: 'Description', status_column: 'Status' },
    flip_signs: false,
  },
  {
    name: 'Commerce Bank — Checking',
    columns: ['Date', 'No.', 'Description', 'Debit', 'Credit'],
    mapping: { date: 'Date', debit: 'Debit', credit: 'Credit', payee: 'Description' },
    flip_signs: false,
  },
]

function builtinPresets(): ImportPreset[] {
  return BUILTIN_PRESET_SPECS.map((spec, i) => ({
    id: i + 1,
    name: spec.name,
    header_fingerprint: fingerprintOf(spec.columns),
    mapping: spec.mapping,
    flip_signs: spec.flip_signs,
    created_at: `${today}T00:00:00`,
    last_account_id: null,
  }))
}

export const importPresets: ImportPreset[] = builtinPresets()

/* ----------------------- AI budget state (v1.2) -------------------------- */
/* The key itself is write-only storage; enabled stays false (stub). Usage is
 * all zeros — the ledger ships before any AI call exists. */

export const aiState = {
  api_key: null as string | null,
  enabled: false,
  monthly_budget_usd: 5,
}

/* ----------------------------- id counters ------------------------------ */

export const nextId = {
  account: 13,
  flow: 9,
  goal: 5,
  member: 4,
  scenario: 3,
  spendingCategory: 11,
  transaction: transactions.length + 1,
  rule: 4,
  transferPair: 9500,
  importPreset: BUILTIN_PRESET_SPECS.length + 1,
}

/* --------------------------- admin reset (#27) --------------------------- */
/* Deep snapshot of the demo state at module load, so mode=demo restores it
 * and mode=empty wipes to a fresh household — mirroring POST /admin/reset.
 * Auth (localStorage), settings, and aiState are deliberately preserved. */

const initialState = structuredClone({
  profile,
  household,
  accounts,
  flows,
  spendingProfile,
  goals,
  scenarios,
  transactions,
  transferCandidates,
  rules,
  balances: [...balances.entries()],
  nextId,
})

function replaceArray<T>(target: T[], next: T[]): void {
  target.splice(0, target.length, ...next)
}

export function resetDb(mode: 'demo' | 'empty'): void {
  transferTombstones.clear()
  externalLinks.clear()
  replaceArray(importPresets, builtinPresets())
  if (mode === 'demo') {
    const snap = structuredClone(initialState)
    Object.assign(profile, snap.profile)
    replaceArray(household, snap.household)
    replaceArray(accounts, snap.accounts)
    replaceArray(flows, snap.flows)
    spendingProfile.categories = snap.spendingProfile.categories
    spendingProfile.monthly_savings_target = snap.spendingProfile.monthly_savings_target
    replaceArray(goals, snap.goals)
    replaceArray(scenarios, snap.scenarios)
    replaceArray(transactions, snap.transactions)
    replaceArray(transferCandidates, snap.transferCandidates)
    replaceArray(rules, snap.rules)
    balances.clear()
    for (const [id, snaps] of snap.balances) balances.set(id, snaps)
    Object.assign(nextId, snap.nextId, { importPreset: nextId.importPreset })
    return
  }
  // empty: a single fresh self member with nulls + defaults profile
  Object.assign(profile, {
    annual_retirement_spending: 80000,
    inflation_pct: 2.5,
    effective_tax_rate_pct: 18, // web Profile type is non-nullable (pre-#26 drift)
  })
  replaceArray(household, [
    {
      id: 1, name: 'You', role: 'self' as const, birth_year: 1980,
      life_expectancy: 92, retirement_age: null, ss_monthly_at_fra: null,
      ss_claim_age: null, notes: '',
    },
  ])
  replaceArray(accounts, [])
  replaceArray(flows, [])
  spendingProfile.categories = []
  spendingProfile.monthly_savings_target = 0
  replaceArray(goals, [])
  replaceArray(scenarios, [])
  replaceArray(transactions, [])
  replaceArray(transferCandidates, [])
  replaceArray(rules, [])
  balances.clear()
  nextId.member = 2
}

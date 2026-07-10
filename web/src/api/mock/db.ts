/** In-memory demo household for VITE_MOCK=1. Age 46, ~$812k net worth.
 * State resets on reload; auth state persists in localStorage. */

import type {
  Account,
  BalanceSnapshot,
  Flow,
  Goal,
  Profile,
  Scenario,
  Settings,
  Transaction,
} from '../types'
import { LIABILITY_TYPES } from '../types'
import { mulberry32, gaussian } from './rng'
import { todayISO } from '@/lib/format'

export const profile: Profile = {
  birth_year: 1980,
  retirement_age: 65,
  life_expectancy: 92,
  annual_retirement_spending: 80000,
  social_security_monthly: 2200,
  social_security_start_age: 67,
  inflation_pct: 2.5,
  effective_tax_rate_pct: 18,
}

const today = todayISO()

export const accounts: Account[] = [
  acc(1, 'Everyday Checking', 'checking', 'First Tech CU', 12400, null, 'cash'),
  acc(2, 'High-Yield Savings', 'savings', 'Ally', 42000, null, 'cash'),
  acc(3, 'Vanguard Brokerage', 'brokerage', 'Vanguard', 178000, null, 'stocks'),
  acc(4, '401(k)', 'retirement', 'Fidelity', 295000, null, 'mixed'),
  acc(5, 'Roth IRA', 'retirement', 'Vanguard', 88000, null, 'stocks'),
  acc(6, 'HSA', 'hsa', 'Fidelity', 24500, null, 'stocks'),
  acc(7, 'House', 'property', '—', 480000, 3.0, null, 'Zestimate, sanity-checked'),
  acc(8, 'Subaru Outback', 'vehicle', '—', 14000, -8.0, null),
  acc(9, 'Mortgage', 'mortgage', 'Rocket', 315000, null, null, '2.9% 30yr, 2021'),
  acc(10, 'Car Loan', 'loan', 'First Tech CU', 6500, null, null),
]

function acc(
  id: number,
  name: string,
  type: Account['type'],
  institution: string,
  balance: number,
  growth: number | null,
  assetClass: Account['asset_class'],
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
    include_in_net_worth: true,
    notes,
    created_at: today,
  }
}

export const flows: Flow[] = [
  flow(1, 'Salary — Brian', 'income', 9800, 3.0, 'salary'),
  flow(2, 'Salary — Dana', 'income', 6200, 3.0, 'salary'),
  flow(3, 'Living expenses', 'expense', 6800, 0, 'living'),
  { ...flow(4, 'Mortgage payment', 'expense', 2350, 0, 'housing'), end_date: '2041-08-01', ends_at_retirement: false },
  { ...flow(5, '401(k) contributions', 'contribution', 1800, 0, 'retirement'), account_id: 4 },
  { ...flow(6, 'Roth IRA', 'contribution', 580, 0, 'retirement'), account_id: 5 },
  { ...flow(7, 'HSA', 'contribution', 350, 0, 'health'), account_id: 6 },
  { ...flow(8, 'Brokerage auto-invest', 'contribution', 1000, 0, 'investing'), account_id: 3 },
]

function flow(
  id: number,
  name: string,
  kind: Flow['kind'],
  monthly: number,
  growth: number,
  category: string,
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
    ends_at_retirement: kind !== 'expense',
  }
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

const PAYEES: [string, string, number, number][] = [
  // payee, category, typical amount, monthly frequency
  ['New Seasons Market', 'groceries', -142, 5],
  ['Fred Meyer', 'groceries', -87, 3],
  ['PGE', 'utilities', -128, 1],
  ['NW Natural', 'utilities', -64, 1],
  ['Comcast', 'utilities', -89, 1],
  ['Chevron', 'auto', -52, 3],
  ['Ristretto Roasters', 'dining', -14, 6],
  ['Nostrana', 'dining', -118, 1],
  ['REI', 'shopping', -95, 0.5],
  ['Powell’s Books', 'shopping', -38, 1],
  ['Netflix', 'subscriptions', -15.49, 1],
  ['Spotify', 'subscriptions', -11.99, 1],
]

export const transactions: Transaction[] = (() => {
  const rng = mulberry32(20260710)
  const out: Transaction[] = []
  let id = 1
  for (let m = 3; m >= 0; m--) {
    const base = new Date()
    base.setMonth(base.getMonth() - m)
    const y = base.getFullYear()
    const mo = base.getMonth() + 1
    const iso = (day: number) =>
      `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`
    // paychecks on the 1st and 15th
    out.push({ id: id++, account_id: 1, date: iso(1), amount: 4900, payee: 'ACME Corp Payroll', category: 'salary' })
    out.push({ id: id++, account_id: 1, date: iso(15), amount: 4900, payee: 'ACME Corp Payroll', category: 'salary' })
    out.push({ id: id++, account_id: 1, date: iso(3), amount: 3100, payee: 'Evergreen Health Payroll', category: 'salary' })
    out.push({ id: id++, account_id: 1, date: iso(5), amount: -2350, payee: 'Rocket Mortgage', category: 'housing' })
    for (const [payee, category, amt, freq] of PAYEES) {
      const n = Math.floor(freq) + (rng() < freq % 1 ? 1 : 0)
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rng() * 27)
        const jitter = 1 + (rng() - 0.5) * 0.3
        out.push({
          id: id++,
          account_id: 1,
          date: iso(day),
          amount: Math.round(amt * jitter * 100) / 100,
          payee,
          category,
        })
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1))
})()

/* ----------------------------- id counters ------------------------------ */

export const nextId = {
  account: 11,
  flow: 9,
  goal: 5,
  scenario: 3,
  transaction: transactions.length + 1,
}

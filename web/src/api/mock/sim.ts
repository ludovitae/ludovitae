/** Mock simulation engine: seeded geometric-brownian-ish Monte Carlo over
 * annual steps so charts look real and respond to parameter changes.
 * Shapes match docs/API.md /simulate exactly. */

import type { Account, Flow, Profile, ScenarioParams, SimResult } from '../types'
import { LIABILITY_TYPES } from '../types'
import { gaussian, mulberry32 } from './rng'

const RETURN_BY_CLASS: Record<string, { mu: number; sigma: number }> = {
  stocks: { mu: 0.07, sigma: 0.15 },
  bonds: { mu: 0.035, sigma: 0.07 },
  cash: { mu: 0.015, sigma: 0.005 },
  mixed: { mu: 0.055, sigma: 0.11 },
}

export interface MockSimInputs {
  profile: Profile
  accounts: Account[]
  flows: Flow[]
  params: ScenarioParams
  nPaths: number
  seed: number
}

export function runMockSim({ profile, accounts, flows, params, nPaths, seed }: MockSimInputs): SimResult {
  const startYear = new Date().getFullYear()
  const startAge = startYear - profile.birth_year
  const lifeExp = profile.life_expectancy
  const nYears = Math.max(1, lifeExp - startAge)
  const ages = Array.from({ length: nYears + 1 }, (_, i) => startAge + i)

  const retirementAge = params.retirement_age ?? profile.retirement_age
  const retirementSpending = params.annual_retirement_spending ?? profile.annual_retirement_spending
  const savingsDelta = (params.monthly_savings_delta ?? 0) * 12
  const inflation = (params.inflation_override_pct ?? profile.inflation_pct) / 100
  const events = params.events ?? []

  // Bucket starting balances.
  const included = accounts.filter((a) => a.include_in_net_worth)
  let cash0 = 0
  let invested0 = 0
  let property0 = 0
  let debt0 = 0
  let wMu = 0
  let wSigma = 0
  let propGrowthWeighted = 0
  for (const a of included) {
    if (LIABILITY_TYPES.includes(a.type)) {
      debt0 += a.balance
    } else if (a.type === 'property' || a.type === 'vehicle' || a.type === 'other_asset') {
      property0 += a.balance
      propGrowthWeighted += ((a.growth_rate_pct ?? 0) / 100) * a.balance
    } else if (a.type === 'checking') {
      cash0 += a.balance
    } else {
      invested0 += a.balance
      const r = RETURN_BY_CLASS[a.asset_class ?? 'mixed'] ?? RETURN_BY_CLASS.mixed!
      wMu += r.mu * a.balance
      wSigma += r.sigma * a.balance
    }
  }
  const propGrowth = property0 > 0 ? propGrowthWeighted / property0 : 0
  let mu = invested0 > 0 ? wMu / invested0 : 0.055
  const sigma = invested0 > 0 ? wSigma / invested0 : 0.11
  if (params.return_override_pct != null) mu = params.return_override_pct / 100

  // Annual pre-retirement flows.
  let incomeAnnual = 0
  let expenseAnnual = 0
  let contribAnnual = 0
  for (const f of flows) {
    if (f.kind === 'income') incomeAnnual += f.amount_monthly * 12
    else if (f.kind === 'expense') expenseAnnual += f.amount_monthly * 12
    else contribAnnual += f.amount_monthly * 12
  }
  // Savings feeding invested assets each pre-retirement year: explicit
  // contributions plus half of free surplus (rest assumed spent/cash drag),
  // plus the scenario's savings delta.
  const surplus = Math.max(0, incomeAnnual - expenseAnnual - contribAnnual)
  const baseSavings = contribAnnual + surplus * 0.5

  const ssAnnual = profile.social_security_monthly * 12
  const debtPayoffYears = 15

  function eventCashflow(age: number, inflator: number): number {
    let v = 0
    for (const e of events) {
      if (e.kind === 'one_time') {
        if (e.age === age) v += (e.amount ?? 0) * inflator
      } else {
        const start = e.start_age ?? startAge
        const end = e.end_age ?? Infinity
        if (age >= start && age <= end) {
          const monthly = e.amount_monthly ?? 0
          v += (e.kind === 'recurring_expense' ? -Math.abs(monthly) : Math.abs(monthly)) * 12 * inflator
        }
      }
    }
    return v
  }

  interface PathOut {
    netWorth: Float64Array
    ruinAge: number | null
  }

  function runPath(rng: (() => number) | null): PathOut {
    let cash = cash0
    let invested = invested0
    let property = property0
    let debt = debt0
    const netWorth = new Float64Array(nYears + 1)
    netWorth[0] = cash + invested + property - debt
    let ruinAge: number | null = null

    for (let i = 1; i <= nYears; i++) {
      const age = startAge + i
      const inflator = Math.pow(1 + inflation, i)
      const drift = mu - (sigma * sigma) / 2
      const shock = rng ? gaussian(rng) : 0
      const ret = rng ? Math.exp(drift + sigma * shock) - 1 : mu

      invested *= 1 + ret
      property *= 1 + propGrowth
      debt = Math.max(0, debt0 * (1 - i / debtPayoffYears))

      let net: number
      if (age <= retirementAge) {
        net = (baseSavings + savingsDelta) * Math.pow(1.02, i)
      } else {
        const ss = age >= profile.social_security_start_age ? ssAnnual * inflator : 0
        net = ss - retirementSpending * inflator
      }
      net += eventCashflow(age, inflator)

      if (net >= 0) {
        invested += net
      } else {
        let need = -net
        const fromCash = Math.min(cash, need * 0.15)
        cash -= fromCash
        need -= fromCash
        invested -= need
      }

      if (invested < 0 && ruinAge === null) ruinAge = age
      netWorth[i] = cash + invested + property - debt
    }
    return { netWorth, ruinAge }
  }

  // Deterministic expected path (no volatility).
  const det = runPath(null)

  // Monte Carlo.
  const paths: Float64Array[] = []
  const ruinAges: number[] = []
  let ruined = 0
  for (let p = 0; p < nPaths; p++) {
    const rng = mulberry32(seed * 7919 + p * 104729 + 1)
    const out = runPath(rng)
    paths.push(out.netWorth)
    if (out.ruinAge !== null) {
      ruined++
      ruinAges.push(out.ruinAge)
    }
  }

  const pct = (q: number): number[] => {
    const out: number[] = []
    const buf = new Float64Array(nPaths)
    for (let i = 0; i <= nYears; i++) {
      for (let p = 0; p < nPaths; p++) buf[p] = paths[p]![i]!
      const sorted = Float64Array.from(buf).sort()
      const idx = Math.min(nPaths - 1, Math.max(0, Math.round(q * (nPaths - 1))))
      out.push(Math.round(sorted[idx]!))
    }
    return out
  }

  const p10 = pct(0.1)
  const p25 = pct(0.25)
  const p50 = pct(0.5)
  const p75 = pct(0.75)
  const p90 = pct(0.9)

  ruinAges.sort((a, b) => a - b)
  const medianRuinAge =
    ruined > nPaths * 0.05 ? (ruinAges[Math.floor(ruinAges.length / 2)] ?? null) : null

  const detNw = Array.from(det.netWorth, (v) => Math.round(v))
  // Rough bucket splits for the deterministic breakdown.
  const investedShare = invested0 / Math.max(1, cash0 + invested0 + property0)
  const cashShare = cash0 / Math.max(1, cash0 + invested0 + property0)

  return {
    engine_version: 'mock-1',
    n_paths: nPaths,
    seed,
    start_year: startYear,
    ages,
    deterministic: {
      net_worth: detNw,
      invested: detNw.map((v, i) => Math.round(Math.max(0, (v + debtAt(i)) * investedShare))),
      cash: detNw.map((v, i) => Math.round(Math.max(0, (v + debtAt(i)) * cashShare))),
      property: detNw.map((_, i) => Math.round(property0 * Math.pow(1 + propGrowth, i))),
      debt: detNw.map((_, i) => Math.round(debtAt(i))),
    },
    percentiles: { p10, p25, p50, p75, p90 },
    success_probability: Math.round((1 - ruined / nPaths) * 1000) / 1000,
    median_ruin_age: medianRuinAge,
    ending_net_worth: {
      p10: p10[nYears]!,
      p50: p50[nYears]!,
      p90: p90[nYears]!,
    },
  }

  function debtAt(i: number): number {
    return Math.max(0, debt0 * (1 - i / debtPayoffYears))
  }
}

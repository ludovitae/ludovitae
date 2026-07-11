/** Mock simulation engine (v1.1): seeded geometric-brownian-ish Monte Carlo
 * over annual steps so charts look real and respond to parameter changes.
 * Shapes match docs/API.md /simulate exactly, including `milestones` —
 * milestones are an ENGINE output (decision log 2026-07-10), computed here
 * from the same effective per-member timing the cash-flow loop uses, so the
 * chart markers always agree with what the mock simulation actually did. */

import type {
  Account,
  Flow,
  HouseholdMember,
  Milestone,
  Profile,
  ScenarioParams,
  SimResult,
  SpendingProfile,
} from '../types'
import { LIABILITY_TYPES } from '../types'
import { gaussian, mulberry32 } from './rng'
import { ssClaimFactor } from '@/lib/ssFactor'

const RETURN_BY_CLASS: Record<string, { mu: number; sigma: number }> = {
  stocks: { mu: 0.07, sigma: 0.15 },
  bonds: { mu: 0.035, sigma: 0.07 },
  cash: { mu: 0.015, sigma: 0.005 },
  mixed: { mu: 0.055, sigma: 0.11 },
}

export interface MockSimInputs {
  profile: Profile
  household: HouseholdMember[]
  accounts: Account[]
  flows: Flow[]
  spending: SpendingProfile
  params: ScenarioParams
  nPaths: number
  seed: number
}

/** A member with scenario overrides resolved (docs/API.md v1.1 precedence:
 * member_overrides > top-level retirement_age sugar for `self` > member). */
interface EffectiveMember {
  m: HouseholdMember
  retirementAge: number | null
  ssClaimAge: number | null
  rmdStartAge: number | null
}

function resolveMembers(
  household: HouseholdMember[],
  accounts: Account[],
  params: ScenarioParams,
): EffectiveMember[] {
  const self = household.find((m) => m.role === 'self') ?? household[0]
  return household.map((m) => {
    const ov = params.member_overrides?.[String(m.id)]
    const retirementAge =
      ov?.retirement_age ?? (m === self ? params.retirement_age : undefined) ?? m.retirement_age
    const ssClaimAge =
      m.ss_monthly_at_fra != null
        ? Math.min(70, Math.max(62, ov?.ss_claim_age ?? m.ss_claim_age ?? 67))
        : null
    // RMDs: owned tax-deferred accounts; unowned ones fall to `self`.
    const ownsTaxDeferred = accounts.some(
      (a) =>
        a.type === 'retirement' &&
        a.include_in_net_worth &&
        (a.member_id === m.id || (a.member_id == null && m.role === 'self')),
    )
    const rmdStartAge = ownsTaxDeferred ? (m.birth_year < 1960 ? 73 : 75) : null
    return { m, retirementAge, ssClaimAge, rmdStartAge }
  })
}

/** Milestones on the self-age axis, sorted by age; beyond-horizon omitted. */
export function buildMilestones(
  household: HouseholdMember[],
  accounts: Account[],
  params: ScenarioParams,
  minSelfAge: number,
  maxSelfAge: number,
): Milestone[] {
  const self = household.find((m) => m.role === 'self') ?? household[0]
  if (!self) return []
  const out: Milestone[] = []
  const push = (year: number, kind: Milestone['kind'], label: string, memberId: number) => {
    const age = year - self.birth_year
    if (age < minSelfAge || age > maxSelfAge) return
    out.push({ age, year, kind, label, member_id: memberId })
  }
  for (const em of resolveMembers(household, accounts, params)) {
    if (em.retirementAge != null)
      push(em.m.birth_year + em.retirementAge, 'retirement', `${em.m.name} retires`, em.m.id)
    if (em.m.ss_monthly_at_fra != null && em.ssClaimAge != null) {
      const pct = Math.round(ssClaimFactor(em.ssClaimAge) * 100)
      push(
        em.m.birth_year + em.ssClaimAge,
        'ss_start',
        `${em.m.name} claims Social Security (${pct}% of FRA)`,
        em.m.id,
      )
    }
    if (em.rmdStartAge != null)
      push(em.m.birth_year + em.rmdStartAge, 'rmd_start', `RMDs begin for ${em.m.name}`, em.m.id)
  }
  const kindOrder: Record<Milestone['kind'], number> = { retirement: 0, ss_start: 1, rmd_start: 2 }
  return out.sort((a, b) => a.age - b.age || kindOrder[a.kind] - kindOrder[b.kind] || a.member_id - b.member_id)
}

export function runMockSim({
  profile,
  household,
  accounts,
  flows,
  spending,
  params,
  nPaths,
  seed,
}: MockSimInputs): SimResult {
  const startYear = new Date().getFullYear()
  const self = household.find((m) => m.role === 'self') ?? household[0]
  if (!self) throw new Error('household must have a self member')
  const selfAge0 = startYear - self.birth_year
  // Horizon runs to the latest life expectancy in the household (v1.1).
  // Mock reading: children are excluded — a 14-year-old's life expectancy
  // would stretch the horizon decades past the adults (flagged to the
  // coordinator as a contract clarification; see T-006 log).
  const endYear = Math.max(
    startYear + 1,
    self.birth_year + self.life_expectancy,
    ...household
      .filter((m) => m.role !== 'child')
      .map((m) => m.birth_year + m.life_expectancy),
  )
  const nYears = endYear - startYear
  const ages = Array.from({ length: nYears + 1 }, (_, i) => selfAge0 + i)

  const members = resolveMembers(household, accounts, params)
  const retirementSpending = params.annual_retirement_spending ?? profile.annual_retirement_spending
  const savingsDelta = (params.monthly_savings_delta ?? 0) * 12
  const inflation = (params.inflation_override_pct ?? profile.inflation_pct) / 100
  // spending_delta_pct scales spending categories + expense flows only.
  const spendScale = 1 + (params.spending_delta_pct ?? 0) / 100
  const taxRate = profile.effective_tax_rate_pct / 100
  const events = params.events ?? []

  // Year index at which the LAST member with a retirement age retires —
  // generic expenses stop and annual_retirement_spending takes over there.
  const retireIdxs = members
    .filter((em) => em.retirementAge != null)
    .map((em) => em.m.birth_year + em.retirementAge! - startYear)
  const lastRetireIdx = retireIdxs.length > 0 ? Math.max(...retireIdxs) : Infinity

  // Bucket starting balances.
  const included = accounts.filter((a) => a.include_in_net_worth)
  let cash0 = 0
  let invested0 = 0
  let property0 = 0
  let debt0 = 0
  let taxDeferred0 = 0
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
      if (a.type === 'retirement') taxDeferred0 += a.balance
      const r = RETURN_BY_CLASS[a.asset_class ?? 'mixed'] ?? RETURN_BY_CLASS.mixed!
      wMu += r.mu * a.balance
      wSigma += r.sigma * a.balance
    }
  }
  const propGrowth = property0 > 0 ? propGrowthWeighted / property0 : 0
  let mu = invested0 > 0 ? wMu / invested0 : 0.055
  const sigma = invested0 > 0 ? wSigma / invested0 : 0.11
  if (params.return_override_pct != null) mu = params.return_override_pct / 100
  const taxDeferredShare = invested0 > 0 ? taxDeferred0 / invested0 : 0

  // A flow's stop year-index: income/contributions with ends_at_retirement
  // stop at their OWNER's retirement (unowned → the last-retirement year).
  function flowStopIdx(f: Flow): number {
    if (!f.ends_at_retirement) return Infinity
    if (f.member_id != null) {
      const owner = members.find((em) => em.m.id === f.member_id)
      if (owner?.retirementAge != null) return owner.m.birth_year + owner.retirementAge - startYear
    }
    return lastRetireIdx
  }
  const incomeFlows = flows.filter((f) => f.kind === 'income').map((f) => ({ annual: f.amount_monthly * 12, stop: flowStopIdx(f) }))
  const contribFlows = flows.filter((f) => f.kind === 'contribution').map((f) => ({ annual: f.amount_monthly * 12, stop: flowStopIdx(f) }))
  // Generic expenses (flows + categories) run until the retirement transition.
  const expenseAnnual =
    flows.filter((f) => f.kind === 'expense').reduce((s, f) => s + f.amount_monthly * 12, 0) * spendScale
  const categoriesAnnual =
    spending.categories.reduce((s, c) => s + c.monthly_amount * 12, 0) * spendScale

  const incomeAt = (i: number) => incomeFlows.reduce((s, f) => s + (i <= f.stop ? f.annual : 0), 0)
  const contribAt = (i: number) => contribFlows.reduce((s, f) => s + (i <= f.stop ? f.annual : 0), 0)

  // Social Security: each member's benefit starts at their claim age, scaled
  // by the claim-age factor (62→0.70 … 70→1.24 around FRA 67).
  function ssAt(i: number, inflator: number): number {
    let v = 0
    for (const em of members) {
      if (em.m.ss_monthly_at_fra == null || em.ssClaimAge == null) continue
      const memberAge = startYear + i - em.m.birth_year
      if (memberAge >= em.ssClaimAge) {
        v += em.m.ss_monthly_at_fra * 12 * ssClaimFactor(em.ssClaimAge) * inflator
      }
    }
    return v
  }

  // RMD tax drag: forced distributions from tax-deferred balances get taxed
  // at the effective rate. Rough mock: ~1/25 of the tax-deferred slice per
  // member past their RMD start age, weighted by that member's share.
  const memberTaxDeferred = new Map<number, number>()
  for (const a of included) {
    if (a.type !== 'retirement') continue
    const ownerId = a.member_id ?? self.id
    memberTaxDeferred.set(ownerId, (memberTaxDeferred.get(ownerId) ?? 0) + a.balance)
  }
  function rmdTaxDragFactor(i: number): number {
    if (taxDeferred0 <= 0) return 0
    let sharePast = 0
    for (const em of members) {
      if (em.rmdStartAge == null) continue
      const memberAge = startYear + i - em.m.birth_year
      if (memberAge >= em.rmdStartAge) sharePast += (memberTaxDeferred.get(em.m.id) ?? 0) / taxDeferred0
    }
    return sharePast * taxDeferredShare * taxRate * (1 / 25)
  }

  function eventCashflow(age: number, inflator: number): number {
    let v = 0
    for (const e of events) {
      if (e.kind === 'one_time') {
        if (e.age === age) v += (e.amount ?? 0) * inflator
      } else {
        const start = e.start_age ?? selfAge0
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

  const debtPayoffYears = 15

  function runPath(rng: (() => number) | null): PathOut {
    let cash = cash0
    let invested = invested0
    let property = property0
    let debt = debt0
    const netWorth = new Float64Array(nYears + 1)
    netWorth[0] = cash + invested + property - debt
    let ruinAge: number | null = null

    for (let i = 1; i <= nYears; i++) {
      const age = selfAge0 + i
      const inflator = Math.pow(1 + inflation, i)
      const drift = mu - (sigma * sigma) / 2
      const shock = rng ? gaussian(rng) : 0
      const ret = rng ? Math.exp(drift + sigma * shock) - 1 : mu

      invested *= 1 + ret
      invested -= invested * rmdTaxDragFactor(i)
      property *= 1 + propGrowth
      debt = Math.max(0, debt0 * (1 - i / debtPayoffYears))

      let net: number
      if (i <= lastRetireIdx) {
        // Accumulation / transition years: whoever still works earns; savings
        // are contributions + half the free surplus, plus the scenario delta.
        const income = incomeAt(i)
        const contrib = contribAt(i)
        const surplus = Math.max(0, income - expenseAnnual - categoriesAnnual - contrib)
        net = (contrib + surplus * 0.5 + savingsDelta) * Math.pow(1.02, i) + ssAt(i, inflator)
      } else {
        // Post-transition: household retirement spending takes over.
        net = ssAt(i, inflator) - retirementSpending * inflator
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
    engine_version: 'mock-1.1',
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
    milestones: buildMilestones(household, accounts, params, selfAge0, selfAge0 + nYears),
  }

  function debtAt(i: number): number {
    return Math.max(0, debt0 * (1 - i / debtPayoffYears))
  }
}

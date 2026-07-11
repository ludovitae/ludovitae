/** Types mirroring docs/API.md (binding contract, v1.1). Do not drift. */

export interface SessionInfo {
  authenticated: boolean
  setup_required: boolean
  csrf_token?: string
}

/** v1.1: household-level assumptions only — person fields moved to HouseholdMember. */
export interface Profile {
  annual_retirement_spending: number
  inflation_pct: number
  effective_tax_rate_pct: number
}

/* ---------------------------- household (v1.1) --------------------------- */

export const MEMBER_ROLES = ['self', 'partner', 'child', 'other'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export interface HouseholdMember {
  id: number
  name: string
  role: MemberRole
  birth_year: number
  life_expectancy: number
  /** nullable: children / non-earners */
  retirement_age: number | null
  ss_monthly_at_fra: number | null
  /** 62–70; benefit scaled by standard actuarial factors around FRA 67 */
  ss_claim_age: number | null
  notes: string
}

export type HouseholdMemberCreate = Omit<HouseholdMember, 'id'>
export type HouseholdMemberPatch = Partial<HouseholdMemberCreate>

export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'brokerage',
  'retirement',
  'hsa',
  'property',
  'vehicle',
  'other_asset',
  'mortgage',
  'loan',
  'credit_card',
  'other_liability',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const LIABILITY_TYPES: readonly AccountType[] = [
  'mortgage',
  'loan',
  'credit_card',
  'other_liability',
]

export const INVESTABLE_TYPES: readonly AccountType[] = ['brokerage', 'retirement', 'hsa', 'savings']

export type AssetClass = 'stocks' | 'bonds' | 'cash' | 'mixed'

export interface Account {
  id: number
  name: string
  type: AccountType
  institution: string
  balance: number
  growth_rate_pct: number | null
  asset_class: AssetClass | null
  /** v1.1: owner; null = household/shared */
  member_id: number | null
  include_in_net_worth: boolean
  notes: string
  created_at: string
}

export type AccountCreate = Omit<Account, 'id' | 'created_at'>
export type AccountPatch = Partial<AccountCreate>

export interface BalanceSnapshot {
  date: string
  amount: number
}

export type FlowKind = 'income' | 'expense' | 'contribution'

export interface Flow {
  id: number
  name: string
  kind: FlowKind
  amount_monthly: number
  annual_growth_pct: number
  start_date: string | null
  end_date: string | null
  account_id: number | null
  category: string
  /** v1.1: owner; income with ends_at_retirement stops at the owner's retirement */
  member_id: number | null
  ends_at_retirement: boolean
}

export type FlowCreate = Omit<Flow, 'id'>
export type FlowPatch = Partial<FlowCreate>

export interface Goal {
  id: number
  name: string
  /** nullable: the backend model stores emoji as optional (Goal.emoji nullable) */
  emoji: string | null
  target_amount: number
  target_date: string | null
  priority: number
  funded_amount: number
  notes: string
}

export type GoalCreate = Omit<Goal, 'id'>
export type GoalPatch = Partial<GoalCreate>

/* ---------------------------- spending (v1.1) ---------------------------- */

export type SpendingKind = 'essential' | 'discretionary'

export interface SpendingCategory {
  id: number
  name: string
  monthly_amount: number
  kind: SpendingKind
  /** null → inflation assumption */
  annual_growth_pct: number | null
}

export interface SpendingProfile {
  categories: SpendingCategory[]
  /** informational for the UI — actual saving comes from contribution flows */
  monthly_savings_target: number
}

/** PUT /spending is a full replace; new categories are sent without an id. */
export interface SpendingCategoryInput extends Omit<SpendingCategory, 'id'> {
  id?: number
}
export interface SpendingProfileInput {
  categories: SpendingCategoryInput[]
  monthly_savings_target: number
}

export interface ObservedCategory {
  category: string
  monthly_avg: number
  txn_count: number
}

export interface ObservedSpending {
  months: number
  from: string
  to: string
  total_monthly_avg: number
  by_category: ObservedCategory[]
}

export interface Transaction {
  id: number
  account_id: number
  date: string
  amount: number
  payee: string
  category: string
}

export interface CsvMapping {
  date: string
  amount: string
  payee: string
  category?: string
}

export interface ImportPreviewCsv {
  columns: string[]
  /** contract ruling 2026-07-10: rows are {column: value} objects */
  sample_rows: Record<string, string>[]
  suggested_mapping: Partial<CsvMapping>
}

export interface ImportPreviewOfx {
  accounts_found: string[]
  transaction_count: number
  balance: number
}

export type ImportPreview = ImportPreviewCsv | ImportPreviewOfx

export interface ImportCommitResult {
  imported: number
  skipped_duplicates: number
}

export type EventKind = 'one_time' | 'recurring_expense' | 'recurring_income'

export interface ScenarioEvent {
  name: string
  kind: EventKind
  /** recurring_*: POSITIVE magnitude — direction implied by kind
   * (contract ruling 2026-07-10). Does not auto-stop at retirement. */
  amount_monthly?: number
  start_age?: number
  end_age?: number | null
  /** one_time: SIGNED — positive = money in */
  amount?: number
  age?: number
}

/** v1.1: per-member timing overrides. Keys of ScenarioParams.member_overrides
 * are member ids as strings (JSON object keys). */
export interface MemberOverride {
  retirement_age?: number
  ss_claim_age?: number
}

export interface ScenarioParams {
  /** v1.1: sugar for the `self` member's retirement_age override (compat) */
  retirement_age?: number
  member_overrides?: Record<string, MemberOverride>
  monthly_savings_delta?: number
  annual_retirement_spending?: number
  /** scales all spending categories + expense flows */
  spending_delta_pct?: number
  return_override_pct?: number | null
  inflation_override_pct?: number | null
  events?: ScenarioEvent[]
}

export interface Scenario {
  id: number
  name: string
  description: string
  is_baseline: boolean
  params: ScenarioParams
}

export type ScenarioCreate = Omit<Scenario, 'id' | 'is_baseline'>
export type ScenarioPatch = Partial<ScenarioCreate>

export type SimulateRequest = ({ scenario_id: number } | { params: ScenarioParams }) & {
  n_paths?: number
  seed?: number
}

/* --------------------------- simulation (v1.1) --------------------------- */

export type MilestoneKind = 'retirement' | 'ss_start' | 'rmd_start'

/** Engine output (never derived in the UI) — expressed on the self-age axis. */
export interface Milestone {
  age: number
  year: number
  kind: MilestoneKind
  label: string
  member_id: number
}

export interface SimResult {
  engine_version: string
  n_paths: number
  seed: number
  start_year: number
  /** the `self` member's age axis */
  ages: number[]
  deterministic: {
    net_worth: number[]
    invested: number[]
    cash: number[]
    property: number[]
    debt: number[]
  }
  percentiles: {
    p10: number[]
    p25: number[]
    p50: number[]
    p75: number[]
    p90: number[]
  }
  success_probability: number
  median_ruin_age: number | null
  ending_net_worth: { p10: number; p50: number; p90: number }
  /** sorted by age; every member's retirement / ss_start / rmd_start */
  milestones: Milestone[]
}

export interface CompareResult {
  results: (SimResult & { scenario_id: number; name: string })[]
}

export interface GoalSummary {
  id: number
  name: string
  emoji: string | null
  target_amount: number
  funded_amount: number
  target_date: string | null
  priority: number
  pct_funded: number
}

export interface DashboardData {
  net_worth: number
  assets: number
  liabilities: number
  history: { date: string; net_worth: number }[]
  by_type: Partial<Record<AccountType, number>>
  goals_summary: GoalSummary[]
  monthly_surplus: number
}

export interface Settings {
  theme: 'fintech' | 'game'
  reduce_motion: boolean
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}

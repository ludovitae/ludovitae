/** Types mirroring docs/API.md (binding contract, v1.2). Do not drift. */

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

/** v1.2 import freshness — server-computed from last_import_at + threshold. */
export type Freshness = 'fresh' | 'aging' | 'stale' | 'never' | 'off'

/** Contract default: freshness tracked for cash/card/investment types,
 * off for property/vehicle/other (non-transactional) types. */
export const FRESHNESS_TRACKED_TYPES: readonly AccountType[] = [
  'checking',
  'savings',
  'brokerage',
  'retirement',
  'hsa',
  'credit_card',
]

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
  /* v1.2 import freshness */
  last_import_at: string | null
  newest_transaction_date: string | null
  /** per-account staleness threshold override in days; null → default 35 */
  staleness_days: number | null
  /** default false for property/vehicle/other, true for cash/card/investment */
  track_freshness: boolean
  freshness: Freshness
}

export type AccountCreate = Omit<
  Account,
  'id' | 'created_at' | 'last_import_at' | 'newest_transaction_date' | 'freshness'
>
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

/** v1.2: how a transaction got its category. */
export type CategorySource = 'manual' | 'rule' | 'heuristic' | 'ai' | 'none'

export interface Transaction {
  id: number
  account_id: number
  date: string
  amount: number
  payee: string
  category: string
  /** v1.2: both legs of a paired transfer share one id; paired transactions
   * are excluded from all spending analytics */
  transfer_pair_id: number | null
  category_source: CategorySource
}

/* --------------- transfers & categorization (v1.2) ----------------------- */

export interface TransferCandidate {
  /** 0–1 match confidence */
  score: number
  txns: [Transaction, Transaction]
}

export type RuleMatch = 'contains' | 'exact'

export interface CategoryRule {
  id: number
  pattern: string
  match: RuleMatch
  field: 'payee'
  category: string
  /** applied ascending, first match wins */
  priority: number
}

export type CategoryRuleCreate = Omit<CategoryRule, 'id'>
export type CategoryRulePatch = Partial<CategoryRuleCreate>

export interface ApplyRulesResult {
  recategorized: number
}

export interface CategorySuggestion {
  payee: string
  /** null when no heuristic matched — the response stays positional (ruling 2026-07-11) */
  category: string | null
  confidence: number
}

export interface SuggestResult {
  suggestions: CategorySuggestion[]
  /** heuristics only in v1.2 — the AI implementation lands behind the same shape */
  source: 'heuristic' | 'ai'
}

/* --------------------- spending analytics (v1.2) ------------------------- */

export interface SpendingSummary {
  /** "2026-01" … */
  months: string[]
  categories: {
    category: string
    /** one total per month, aligned with `months` */
    totals: number[]
    total: number
  }[]
  grand_total: number
}

export type RecurringCadence = 'monthly' | 'weekly' | 'annual'

export interface RecurringCharge {
  payee: string
  category: string
  cadence: RecurringCadence
  typical_amount: number
  last_amount: number
  /** flagged, not disqualifying; 0 when the price is steady */
  price_change_pct: number
  last_date: string
  first_seen: string
  occurrences: number
  /** seen within 1.5× cadence */
  active: boolean
  monthly_equivalent: number
  /** stddev/median of occurrence amounts × 100 (ruling 2026-07-11) — lets the
   * UI segment true subscriptions (≤ ~5%) from spending habits */
  amount_variability_pct: number
}

export interface SpendingHotspots {
  category_spikes: {
    category: string
    recent_monthly_avg: number
    baseline_monthly_avg: number
    delta_pct: number
  }[]
  top_merchants: { payee: string; monthly_avg: number; txn_count: number }[]
  price_increases: RecurringCharge[]
  /** active, low-variance, running ≥ 12 months */
  possibly_forgotten: RecurringCharge[]
}

export interface SpendingForecast {
  months: string[]
  /** projected recurring total per month, aligned with `months` — annual
   * charges lump in their anniversary month (T-007 pinned shape) */
  recurring: number[]
  /** flat per-category averages (6-full-month lookback, recurring payees
   * excluded); the client derives constant series */
  variable_by_category: { category: string; monthly_avg: number }[]
  total: number[]
}

/* ----------------------- AI budget & admin (v1.2) ------------------------ */

export interface AiSettings {
  has_api_key: boolean
  /** null until a key is stored; the key itself is write-only */
  api_key_last4: string | null
  enabled: boolean
  monthly_budget_usd: number
  spend_this_month_usd: number
  tokens_this_month: { input: number; output: number }
}

/** PUT /settings/ai — key is write-only; api_key: null deletes it. */
export interface AiSettingsUpdate {
  api_key?: string | null
  enabled?: boolean
  monthly_budget_usd?: number
}

export interface AiUsageMonth {
  month: string
  input_tokens: number
  output_tokens: number
  est_cost_usd: number
  by_purpose: Record<
    string,
    { input_tokens: number; output_tokens: number; est_cost_usd: number }
  >
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

/** Engine v2 (T-011a): the resolved PlanInputs the run actually used —
 * scenario overrides included, never re-read from the DB. */
export interface SimAssumptions {
  market: {
    stocks_mean_pct: number
    stocks_vol_pct: number
    bonds_mean_pct: number
    bonds_vol_pct: number
    cash_mean_pct: number
    cash_vol_pct: number
  }
  inflation_pct: number
  effective_tax_rate_pct: number
  ss_taxable_share: number
  engine_version: string
  /** reserved for the T-012 phase-2 integration */
  tax_model?: 'flat' | 'brackets'
}

export interface SimResult {
  engine_version: string
  /** engine v2: human-readable behavior changes since the prior engine version */
  engine_notes: string[]
  /** faithful passthrough — the assumptions strip UI is T-011b */
  assumptions: SimAssumptions
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

export interface StaleAccount {
  id: number
  name: string
  freshness: Freshness
  days_since_import: number | null
}

export interface DashboardData {
  net_worth: number
  assets: number
  liabilities: number
  history: { date: string; net_worth: number }[]
  by_type: Partial<Record<AccountType, number>>
  goals_summary: GoalSummary[]
  monthly_surplus: number
  /** v1.2: aging + stale only */
  stale_accounts: StaleAccount[]
}

export interface Settings {
  theme: 'fintech' | 'game'
  reduce_motion: boolean
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}

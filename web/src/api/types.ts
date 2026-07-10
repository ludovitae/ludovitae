/** Types mirroring docs/API.md (binding contract). Do not drift. */

export interface SessionInfo {
  authenticated: boolean
  setup_required: boolean
  csrf_token?: string
}

export interface Profile {
  birth_year: number
  retirement_age: number
  life_expectancy: number
  annual_retirement_spending: number
  social_security_monthly: number
  social_security_start_age: number
  inflation_pct: number
  effective_tax_rate_pct: number
}

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
  ends_at_retirement: boolean
}

export type FlowCreate = Omit<Flow, 'id'>
export type FlowPatch = Partial<FlowCreate>

export interface Goal {
  id: number
  name: string
  emoji: string
  target_amount: number
  target_date: string | null
  priority: number
  funded_amount: number
  notes: string
}

export type GoalCreate = Omit<Goal, 'id'>
export type GoalPatch = Partial<GoalCreate>

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
  sample_rows: string[][]
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
  /** recurring_*: monthly amount (positive = money in) */
  amount_monthly?: number
  start_age?: number
  end_age?: number | null
  /** one_time */
  amount?: number
  age?: number
}

export interface ScenarioParams {
  retirement_age?: number
  monthly_savings_delta?: number
  annual_retirement_spending?: number
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

export interface SimResult {
  engine_version: string
  n_paths: number
  seed: number
  start_year: number
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
}

export interface CompareResult {
  results: (SimResult & { scenario_id: number; name: string })[]
}

export interface DashboardData {
  net_worth: number
  assets: number
  liabilities: number
  history: { date: string; net_worth: number }[]
  by_type: Partial<Record<AccountType, number>>
  goals_summary: Goal[]
  monthly_surplus: number
}

export interface Settings {
  theme: 'fintech' | 'game'
  reduce_motion: boolean
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}

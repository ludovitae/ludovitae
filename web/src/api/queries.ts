/** TanStack Query hooks over the typed client. Simulation queries keep
 * previous data so charts interpolate instead of flashing empty. */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import type {
  AccountCreate,
  AccountPatch,
  AiSettingsUpdate,
  BalanceSnapshot,
  CategoryRuleCreate,
  CategoryRulePatch,
  FlowCreate,
  FlowPatch,
  GoalCreate,
  GoalPatch,
  HouseholdMemberCreate,
  HouseholdMemberPatch,
  Profile,
  ScenarioCreate,
  ScenarioParams,
  ScenarioPatch,
  Settings,
  SpendingProfileInput,
} from './types'
import { serializeParams } from '@/lib/scenarioParams'

export const qk = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  profile: ['profile'] as const,
  household: ['household'] as const,
  spending: ['spending'] as const,
  observedSpending: (months: number) => ['spending', 'observed', months] as const,
  accounts: ['accounts'] as const,
  balances: (id: number) => ['balances', id] as const,
  flows: ['flows'] as const,
  goals: ['goals'] as const,
  scenarios: ['scenarios'] as const,
  transactions: (accountId?: number) => ['transactions', accountId ?? 'all'] as const,
  simulate: (paramsKey: string) => ['simulate', paramsKey] as const,
  compare: (ids: number[]) => ['compare', ids.join(',')] as const,
  settings: ['settings'] as const,
  /* v1.2 */
  spendingSummary: (from: string, to: string) => ['spending', 'summary', from, to] as const,
  spendingRecurring: ['spending', 'recurring'] as const,
  spendingHotspots: (months: number) => ['spending', 'hotspots', months] as const,
  spendingForecast: (months: number) => ['spending', 'forecast', months] as const,
  transferCandidates: ['transfers', 'candidates'] as const,
  uncategorized: ['transactions', 'uncategorized'] as const,
  rules: ['rules'] as const,
  aiSettings: ['ai', 'settings'] as const,
  aiUsage: (months: number) => ['ai', 'usage', months] as const,
}

export function useSession() {
  return useQuery({ queryKey: qk.session, queryFn: api.auth.session, staleTime: 60_000, retry: false })
}

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: api.dashboard })
}

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: api.profile.get })
}

export function useHousehold() {
  return useQuery({ queryKey: qk.household, queryFn: api.household.list })
}

export function useSpending() {
  return useQuery({ queryKey: qk.spending, queryFn: api.spending.get })
}

/** Observed spending over a trailing window; previous window's data is held
 * while the new one loads so the bars never flash empty. */
export function useObservedSpending(months: number) {
  return useQuery({
    queryKey: qk.observedSpending(months),
    queryFn: () => api.spending.observed(months),
    placeholderData: keepPreviousData,
  })
}

export function useAccounts() {
  return useQuery({ queryKey: qk.accounts, queryFn: api.accounts.list })
}

export function useBalances(accountId: number | null) {
  return useQuery({
    queryKey: qk.balances(accountId ?? -1),
    queryFn: () => api.accounts.balances(accountId!),
    enabled: accountId !== null,
  })
}

export function useFlows() {
  return useQuery({ queryKey: qk.flows, queryFn: api.flows.list })
}

export function useGoals() {
  return useQuery({ queryKey: qk.goals, queryFn: api.goals.list })
}

export function useScenarios() {
  return useQuery({ queryKey: qk.scenarios, queryFn: api.scenarios.list })
}

export function useTransactions(accountId?: number, limit = 200) {
  return useQuery({
    queryKey: qk.transactions(accountId),
    queryFn: () => api.transactions.list({ account_id: accountId, limit }),
  })
}

export function useSettingsQuery() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings.get, staleTime: 300_000 })
}

/* ------------------------- v1.2 analytics queries ------------------------ */
/* Windowed analytics hold the previous slice while a new one loads so charts
 * never flash empty (same rule as observed spending / simulations). */

export function useSpendingSummary(from: string, to: string) {
  return useQuery({
    queryKey: qk.spendingSummary(from, to),
    queryFn: () => api.spending.summary({ from, to }),
    placeholderData: keepPreviousData,
  })
}

export function useSpendingRecurring() {
  return useQuery({ queryKey: qk.spendingRecurring, queryFn: api.spending.recurring })
}

export function useSpendingHotspots(months: number) {
  return useQuery({
    queryKey: qk.spendingHotspots(months),
    queryFn: () => api.spending.hotspots(months),
    placeholderData: keepPreviousData,
  })
}

export function useSpendingForecast(months: number) {
  return useQuery({
    queryKey: qk.spendingForecast(months),
    queryFn: () => api.spending.forecast(months),
    placeholderData: keepPreviousData,
  })
}

export function useTransferCandidates() {
  return useQuery({ queryKey: qk.transferCandidates, queryFn: api.transfers.candidates })
}

export function useUncategorized() {
  return useQuery({
    queryKey: qk.uncategorized,
    queryFn: () => api.transactions.list({ uncategorized: 1, limit: 500 }),
  })
}

export function useRules() {
  return useQuery({ queryKey: qk.rules, queryFn: api.rules.list })
}

export function useAiSettings() {
  return useQuery({ queryKey: qk.aiSettings, queryFn: api.ai.settings })
}

export function useAiUsage(months: number) {
  return useQuery({ queryKey: qk.aiUsage(months), queryFn: () => api.ai.usage(months) })
}

/** Live simulation for the studio. Caller debounces `params`; previous data
 * is held during refetch so the fan chart never flashes empty. */
export function useSimulation(params: ScenarioParams, opts?: { enabled?: boolean; seed?: number }) {
  const paramsKey = serializeParams(params)
  return useQuery({
    queryKey: qk.simulate(paramsKey),
    queryFn: () => api.simulate({ params, seed: opts?.seed ?? 42 }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled: opts?.enabled ?? true,
  })
}

export function useCompare(scenarioIds: number[], enabled: boolean) {
  return useQuery({
    queryKey: qk.compare(scenarioIds),
    queryFn: () => api.scenarios.compare(scenarioIds, 1000, 42),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled: enabled && scenarioIds.length > 0,
  })
}

/* ------------------------------ mutations -------------------------------- */

function useInvalidating<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  keys: readonly (readonly unknown[])[],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(...args),
    onSuccess: () => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k as unknown[] })
    },
  })
}

export function useUpdateProfile() {
  return useInvalidating(
    (p: Profile) => api.profile.update(p),
    [qk.profile, qk.dashboard, ['simulate'], ['compare']],
  )
}

/* household members feed the sim (timing) — invalidate simulations too */

export function useCreateMember() {
  return useInvalidating(
    (m: HouseholdMemberCreate) => api.household.create(m),
    [qk.household, ['simulate'], ['compare']],
  )
}

export function usePatchMember() {
  return useInvalidating(
    (id: number, patch: HouseholdMemberPatch) => api.household.patch(id, patch),
    [qk.household, ['simulate'], ['compare']],
  )
}

export function useDeleteMember() {
  return useInvalidating(
    (id: number) => api.household.remove(id),
    [qk.household, qk.accounts, qk.flows, ['simulate'], ['compare']],
  )
}

export function useUpdateSpending() {
  return useInvalidating(
    (s: SpendingProfileInput) => api.spending.update(s),
    [qk.spending, qk.dashboard, ['simulate'], ['compare']],
  )
}

export function useCreateFlow() {
  return useInvalidating(
    (f: FlowCreate) => api.flows.create(f),
    [qk.flows, qk.dashboard, ['simulate'], ['compare']],
  )
}

export function usePatchFlow() {
  return useInvalidating(
    (id: number, patch: FlowPatch) => api.flows.patch(id, patch),
    [qk.flows, qk.dashboard, ['simulate'], ['compare']],
  )
}

export function useDeleteFlow() {
  return useInvalidating(
    (id: number) => api.flows.remove(id),
    [qk.flows, qk.dashboard, ['simulate'], ['compare']],
  )
}

export function useCreateAccount() {
  return useInvalidating((a: AccountCreate) => api.accounts.create(a), [qk.accounts, qk.dashboard])
}

export function usePatchAccount() {
  return useInvalidating(
    (id: number, patch: AccountPatch) => api.accounts.patch(id, patch),
    [qk.accounts, qk.dashboard, ['balances'], ['simulate'], ['compare']],
  )
}

export function useDeleteAccount() {
  return useInvalidating((id: number) => api.accounts.remove(id), [qk.accounts, qk.dashboard])
}

export function useAddBalance() {
  return useInvalidating(
    (id: number, snap: BalanceSnapshot) => api.accounts.addBalance(id, snap),
    [qk.accounts, qk.dashboard, ['balances']],
  )
}

export function useDeleteBalance() {
  return useInvalidating(
    (id: number, date: string) => api.accounts.removeBalance(id, date),
    [qk.accounts, qk.dashboard, ['balances']],
  )
}

export function useCreateGoal() {
  return useInvalidating((g: GoalCreate) => api.goals.create(g), [qk.goals, qk.dashboard])
}

export function usePatchGoal() {
  return useInvalidating(
    (id: number, patch: GoalPatch) => api.goals.patch(id, patch),
    [qk.goals, qk.dashboard],
  )
}

export function useDeleteGoal() {
  return useInvalidating((id: number) => api.goals.remove(id), [qk.goals, qk.dashboard])
}

export function useCreateScenario() {
  return useInvalidating((s: ScenarioCreate) => api.scenarios.create(s), [qk.scenarios])
}

export function usePatchScenario() {
  return useInvalidating(
    (id: number, patch: ScenarioPatch) => api.scenarios.patch(id, patch),
    [qk.scenarios, ['compare']],
  )
}

export function useDeleteScenario() {
  return useInvalidating((id: number) => api.scenarios.remove(id), [qk.scenarios, ['compare']])
}

export function usePatchSettings() {
  return useInvalidating((s: Partial<Settings>) => api.settings.patch(s), [qk.settings])
}

/* --------------------------- v1.2 mutations ------------------------------ */
/* Pairing and categorization change what the analytics see — invalidate the
 * whole ['spending'] prefix (profile + observed + summary/recurring/etc.). */

export function usePairTransfers() {
  return useInvalidating(
    (ids: [number, number]) => api.transfers.pair(ids),
    [qk.transferCandidates, ['transactions'], ['spending']],
  )
}

export function useUnpairTransfer() {
  return useInvalidating(
    (pairId: number) => api.transfers.unpair(pairId),
    [qk.transferCandidates, ['transactions'], ['spending']],
  )
}

export function useCategorizeTransactions() {
  return useInvalidating(
    (ids: number[], category: string) => api.transactions.categorize(ids, category),
    [['transactions'], ['spending']],
  )
}

export function useCreateRule() {
  return useInvalidating((r: CategoryRuleCreate) => api.rules.create(r), [qk.rules])
}

export function usePatchRule() {
  return useInvalidating(
    (id: number, patch: CategoryRulePatch) => api.rules.patch(id, patch),
    [qk.rules],
  )
}

export function useDeleteRule() {
  return useInvalidating((id: number) => api.rules.remove(id), [qk.rules])
}

export function useApplyRules() {
  return useInvalidating(() => api.rules.apply(), [qk.rules, ['transactions'], ['spending']])
}

export function useUpdateAiSettings() {
  return useInvalidating((s: AiSettingsUpdate) => api.ai.update(s), [['ai']])
}

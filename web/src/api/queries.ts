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
  BalanceSnapshot,
  GoalCreate,
  GoalPatch,
  Profile,
  ScenarioCreate,
  ScenarioParams,
  ScenarioPatch,
  Settings,
} from './types'
import { serializeParams } from '@/lib/scenarioParams'

export const qk = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  profile: ['profile'] as const,
  accounts: ['accounts'] as const,
  balances: (id: number) => ['balances', id] as const,
  flows: ['flows'] as const,
  goals: ['goals'] as const,
  scenarios: ['scenarios'] as const,
  transactions: (accountId?: number) => ['transactions', accountId ?? 'all'] as const,
  simulate: (paramsKey: string) => ['simulate', paramsKey] as const,
  compare: (ids: number[]) => ['compare', ids.join(',')] as const,
  settings: ['settings'] as const,
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

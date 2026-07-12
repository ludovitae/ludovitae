/** Typed API client for /api/v1 per docs/API.md.
 * - CSRF token attached to every mutating request (X-CSRF-Token).
 * - 401 anywhere → onUnauthorized callback (router redirects to /login).
 * - VITE_MOCK=1 routes every call through the in-browser mock instead. */

import type {
  Account,
  AccountCreate,
  AccountMap,
  AccountPatch,
  AdminResetResult,
  AiSettings,
  AiSettingsUpdate,
  AiUsageMonth,
  ApplyRulesResult,
  BalanceSnapshot,
  CategoryRule,
  CategoryRuleCreate,
  CategoryRulePatch,
  CompareResult,
  CsvMapping,
  DashboardData,
  Flow,
  FlowCreate,
  FlowPatch,
  Goal,
  GoalCreate,
  GoalPatch,
  HouseholdMember,
  HouseholdMemberCreate,
  HouseholdMemberPatch,
  ImportCommitResult,
  ImportPreset,
  ImportPreview,
  NewAccountPayload,
  ObservedSpending,
  Plan,
  PlanMeta,
  PlanTracking,
  Profile,
  Scenario,
  ScenarioCreate,
  ScenarioPatch,
  SessionInfo,
  Settings,
  SimResult,
  SimulateRequest,
  SnapshotCreate,
  TrackingMetric,
  RecurringCharge,
  SpendingForecast,
  SpendingHotspots,
  SpendingProfile,
  SpendingProfileInput,
  SpendingSummary,
  SuggestResult,
  Transaction,
  TransferCandidate,
} from './types'

export const MOCK = import.meta.env.VITE_MOCK === '1'

const BASE = '/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let csrfToken: string | null = null
export function setCsrfToken(token: string | null) {
  csrfToken = token
}

let onUnauthorized: (() => void) | null = null
export function registerUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

interface RequestOpts {
  json?: unknown
  form?: FormData
  query?: Record<string, string | number | undefined>
  /** auth endpoints handle their own 401s */
  skipAuthRedirect?: boolean
}

async function request<T>(method: Method, path: string, opts: RequestOpts = {}): Promise<T> {
  if (MOCK) {
    const { mockRequest } = await import('./mock/handlers')
    return mockRequest<T>(method, path, opts.json, opts.form, opts.query)
  }

  let url = BASE + path
  if (opts.query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    }
    const s = qs.toString()
    if (s) url += `?${s}`
  }

  const headers: Record<string, string> = {}
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.json !== undefined ? JSON.stringify(opts.json) : (opts.form ?? null),
  })

  if (res.status === 401 && !opts.skipAuthRedirect) {
    onUnauthorized?.()
    throw new ApiError(401, 'unauthenticated', 'Session expired')
  }

  if (res.status === 204) return undefined as T

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? res.statusText)
  }
  return body as T
}

export const api = {
  auth: {
    session: () => request<SessionInfo>('GET', '/auth/session', { skipAuthRedirect: true }),
    setup: (password: string) =>
      request<void>('POST', '/auth/setup', { json: { password }, skipAuthRedirect: true }),
    login: async (password: string) => {
      const res = await request<{ csrf_token: string }>('POST', '/auth/login', {
        json: { password },
        skipAuthRedirect: true,
      })
      setCsrfToken(res.csrf_token)
      return res
    },
    logout: async () => {
      await request<void>('POST', '/auth/logout')
      setCsrfToken(null)
    },
  },

  profile: {
    get: () => request<Profile>('GET', '/profile'),
    update: (p: Profile) => request<Profile>('PUT', '/profile', { json: p }),
  },

  household: {
    list: () => request<HouseholdMember[]>('GET', '/household'),
    get: (id: number) => request<HouseholdMember>('GET', `/household/${id}`),
    create: (m: HouseholdMemberCreate) => request<HouseholdMember>('POST', '/household', { json: m }),
    patch: (id: number, m: HouseholdMemberPatch) =>
      request<HouseholdMember>('PATCH', `/household/${id}`, { json: m }),
    remove: (id: number) => request<void>('DELETE', `/household/${id}`),
  },

  spending: {
    get: () => request<SpendingProfile>('GET', '/spending'),
    update: (s: SpendingProfileInput) => request<SpendingProfile>('PUT', '/spending', { json: s }),
    observed: (months: number) =>
      request<ObservedSpending>('GET', '/spending/observed', { query: { months } }),
    /* v1.2 analytics — all exclude transfer-paired transactions */
    summary: (params: { from?: string; to?: string } = {}) =>
      request<SpendingSummary>('GET', '/spending/summary', {
        query: { ...params, group_by: 'month' },
      }),
    recurring: () => request<RecurringCharge[]>('GET', '/spending/recurring'),
    hotspots: (months: number) =>
      request<SpendingHotspots>('GET', '/spending/hotspots', { query: { months } }),
    forecast: (months: number) =>
      request<SpendingForecast>('GET', '/spending/forecast', { query: { months } }),
  },

  /* v1.2 transfers & categorization */
  transfers: {
    candidates: () => request<TransferCandidate[]>('GET', '/transfers/candidates'),
    /** 200 with both updated legs (link op, not resource creation — ruling) */
    pair: (transactionIds: [number, number]) =>
      request<Transaction[]>('POST', '/transfers/pair', { json: { transaction_ids: transactionIds } }),
    /** unlink AND tombstone — never auto-paired again (ruling 2026-07-11) */
    unpair: (pairId: number) => request<void>('DELETE', `/transfers/pair/${pairId}`),
    /** persistent dismissal tombstone; the candidate never resurfaces (ruling 2026-07-11) */
    dismissCandidate: (transactionIds: [number, number]) =>
      request<void>('POST', '/transfers/candidates/dismiss', {
        json: { transaction_ids: transactionIds },
      }),
  },

  rules: {
    list: () => request<CategoryRule[]>('GET', '/rules'),
    create: (r: CategoryRuleCreate) => request<CategoryRule>('POST', '/rules', { json: r }),
    patch: (id: number, r: CategoryRulePatch) => request<CategoryRule>('PATCH', `/rules/${id}`, { json: r }),
    remove: (id: number) => request<void>('DELETE', `/rules/${id}`),
    apply: () => request<ApplyRulesResult>('POST', '/rules/apply'),
  },

  categorize: {
    /** heuristics-only in v1.2; the Claude implementation lands behind the same shape */
    suggest: (payees: string[]) =>
      request<SuggestResult>('POST', '/categorize/suggest', { json: { payees } }),
  },

  accounts: {
    list: () => request<Account[]>('GET', '/accounts'),
    get: (id: number) => request<Account>('GET', `/accounts/${id}`),
    create: (a: AccountCreate) => request<Account>('POST', '/accounts', { json: a }),
    patch: (id: number, a: AccountPatch) => request<Account>('PATCH', `/accounts/${id}`, { json: a }),
    remove: (id: number) => request<void>('DELETE', `/accounts/${id}`),
    balances: (id: number) => request<BalanceSnapshot[]>('GET', `/accounts/${id}/balances`),
    addBalance: (id: number, snap: BalanceSnapshot) =>
      request<BalanceSnapshot>('POST', `/accounts/${id}/balances`, { json: snap }),
    removeBalance: (id: number, date: string) =>
      request<void>('DELETE', `/accounts/${id}/balances/${date}`),
  },

  flows: {
    list: () => request<Flow[]>('GET', '/flows'),
    create: (f: FlowCreate) => request<Flow>('POST', '/flows', { json: f }),
    patch: (id: number, f: FlowPatch) => request<Flow>('PATCH', `/flows/${id}`, { json: f }),
    remove: (id: number) => request<void>('DELETE', `/flows/${id}`),
  },

  goals: {
    list: () => request<Goal[]>('GET', '/goals'),
    create: (g: GoalCreate) => request<Goal>('POST', '/goals', { json: g }),
    patch: (id: number, g: GoalPatch) => request<Goal>('PATCH', `/goals/${id}`, { json: g }),
    remove: (id: number) => request<void>('DELETE', `/goals/${id}`),
  },

  transactions: {
    list: (
      params: {
        account_id?: number
        from?: string
        to?: string
        limit?: number
        /** v1.2: pass 1 for the uncategorized review queue */
        uncategorized?: number
      } = {},
    ) => request<Transaction[]>('GET', '/transactions', { query: params }),
    /** v1.2 bulk categorize — sets category_source: "manual";
     * returns {updated} (ruling 2026-07-11) */
    categorize: (ids: number[], category: string) =>
      request<{ updated: number }>('POST', '/transactions/categorize', { json: { ids, category } }),
  },

  import: {
    /** #26: accountId is optional (the create-new flow has no account yet);
     * mapping overrides the effective mapping for sign hint/account groups */
    preview: (
      file: File,
      kind: 'csv' | 'ofx',
      accountId?: number | null,
      opts: { mapping?: Partial<CsvMapping> } = {},
    ) => {
      const form = new FormData()
      form.set('file', file)
      form.set('kind', kind)
      if (accountId != null) form.set('account_id', String(accountId))
      if (opts.mapping) form.set('mapping', JSON.stringify(opts.mapping))
      return request<ImportPreview>('POST', '/import/preview', { form })
    },
    /* #26: target is account_id XOR new_account; multi-account CSVs route
     * via accountMap instead. */
    commit: (
      file: File,
      kind: 'csv' | 'ofx',
      target:
        | { accountId: number }
        | { newAccount: NewAccountPayload }
        | { accountMap: AccountMap },
      mapping: CsvMapping | null,
      updateBalance: boolean,
      /* v1.2.2 (T-009): sign flip + preset save (upsert by fingerprint) */
      opts: { flipSigns?: boolean; savePreset?: string } = {},
    ) => {
      const form = new FormData()
      form.set('file', file)
      form.set('kind', kind)
      if ('accountId' in target) form.set('account_id', String(target.accountId))
      if ('newAccount' in target) form.set('new_account', JSON.stringify(target.newAccount))
      if ('accountMap' in target) form.set('account_map', JSON.stringify(target.accountMap))
      if (mapping) form.set('mapping', JSON.stringify(mapping))
      form.set('update_balance', String(updateBalance))
      if (opts.flipSigns) form.set('flip_signs', 'true')
      if (opts.savePreset?.trim()) form.set('save_preset', opts.savePreset.trim())
      return request<ImportCommitResult>('POST', '/import/commit', { form })
    },
    /* v1.2.2 (T-009): institution mapping presets */
    presets: () => request<ImportPreset[]>('GET', '/import/presets'),
    removePreset: (id: number) => request<void>('DELETE', `/import/presets/${id}`),
  },

  /** #27: start from scratch. confirm must be exactly "reset ludovitae". */
  admin: {
    reset: (mode: 'demo' | 'empty', confirm: string) =>
      request<AdminResetResult>('POST', '/admin/reset', { json: { mode, confirm } }),
  },

  scenarios: {
    list: () => request<Scenario[]>('GET', '/scenarios'),
    get: (id: number) => request<Scenario>('GET', `/scenarios/${id}`),
    create: (s: ScenarioCreate) => request<Scenario>('POST', '/scenarios', { json: s }),
    patch: (id: number, s: ScenarioPatch) => request<Scenario>('PATCH', `/scenarios/${id}`, { json: s }),
    remove: (id: number) => request<void>('DELETE', `/scenarios/${id}`),
    compare: (scenarioIds: number[], nPaths?: number, seed?: number) =>
      request<CompareResult>('POST', '/scenarios/compare', {
        json: { scenario_ids: scenarioIds, n_paths: nPaths, seed },
      }),
  },

  simulate: (req: SimulateRequest) => request<SimResult>('POST', '/simulate', { json: req }),

  /* v1.3 (#21): plan snapshots + plan-vs-actuals tracking */
  plans: {
    list: () => request<PlanMeta[]>('GET', '/plans'),
    get: (id: number) => request<Plan>('GET', `/plans/${id}`),
    /** runs a sim now, freezes it; the first snapshot auto-benchmarks */
    snapshot: (body: SnapshotCreate) => request<Plan>('POST', '/plans/snapshot', { json: body }),
    remove: (id: number) => request<void>('DELETE', `/plans/${id}`),
    /** promoting one benchmark demotes every other (zero-or-one invariant) */
    setBenchmark: (id: number, isBenchmark: boolean) =>
      request<Plan>('PATCH', `/plans/${id}`, { json: { is_benchmark: isBenchmark } }),
    tracking: (id: number, metric: TrackingMetric) =>
      request<PlanTracking>('GET', `/plans/${id}/tracking`, { query: { metric } }),
  },

  dashboard: () => request<DashboardData>('GET', '/dashboard'),

  settings: {
    get: () => request<Settings>('GET', '/settings'),
    patch: (s: Partial<Settings>) => request<Settings>('PATCH', '/settings', { json: s }),
  },

  /* v1.2 AI budget & admin — ships before any AI calls exist */
  ai: {
    settings: () => request<AiSettings>('GET', '/settings/ai'),
    update: (s: AiSettingsUpdate) => request<AiSettings>('PUT', '/settings/ai', { json: s }),
    usage: (months: number) => request<AiUsageMonth[]>('GET', '/ai/usage', { query: { months } }),
  },
}

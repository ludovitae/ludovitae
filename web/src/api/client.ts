/** Typed API client for /api/v1 per docs/API.md.
 * - CSRF token attached to every mutating request (X-CSRF-Token).
 * - 401 anywhere → onUnauthorized callback (router redirects to /login).
 * - VITE_MOCK=1 routes every call through the in-browser mock instead. */

import type {
  Account,
  AccountCreate,
  AccountPatch,
  BalanceSnapshot,
  CompareResult,
  CsvMapping,
  DashboardData,
  Flow,
  FlowCreate,
  FlowPatch,
  Goal,
  GoalCreate,
  GoalPatch,
  ImportCommitResult,
  ImportPreview,
  Profile,
  Scenario,
  ScenarioCreate,
  ScenarioPatch,
  SessionInfo,
  Settings,
  SimResult,
  SimulateRequest,
  Transaction,
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
    list: (params: { account_id?: number; from?: string; to?: string; limit?: number } = {}) =>
      request<Transaction[]>('GET', '/transactions', { query: params }),
  },

  import: {
    preview: (file: File, kind: 'csv' | 'ofx', accountId: number) => {
      const form = new FormData()
      form.set('file', file)
      form.set('kind', kind)
      form.set('account_id', String(accountId))
      return request<ImportPreview>('POST', '/import/preview', { form })
    },
    commit: (
      file: File,
      kind: 'csv' | 'ofx',
      accountId: number,
      mapping: CsvMapping | null,
      updateBalance: boolean,
    ) => {
      const form = new FormData()
      form.set('file', file)
      form.set('kind', kind)
      form.set('account_id', String(accountId))
      if (mapping) form.set('mapping', JSON.stringify(mapping))
      form.set('update_balance', String(updateBalance))
      return request<ImportCommitResult>('POST', '/import/commit', { form })
    },
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

  dashboard: () => request<DashboardData>('GET', '/dashboard'),

  settings: {
    get: () => request<Settings>('GET', '/settings'),
    patch: (s: Partial<Settings>) => request<Settings>('PATCH', '/settings', { json: s }),
  },
}

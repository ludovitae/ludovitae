/** Mock API router for VITE_MOCK=1 — faithful to docs/API.md shapes and
 * status codes so swapping to the real backend is a config change. */

import { ApiError } from '../client'
import type {
  Account,
  BalanceSnapshot,
  CompareResult,
  CsvMapping,
  DashboardData,
  Flow,
  Goal,
  ImportPreview,
  Scenario,
  ScenarioParams,
  SessionInfo,
  SimulateRequest,
} from '../types'
import { LIABILITY_TYPES } from '../types'
import * as db from './db'
import { runMockSim } from './sim'
import { todayISO } from '@/lib/format'

const PW_KEY = 'gol.mock.password'
const AUTHED_KEY = 'gol.mock.authed'
const CSRF = 'mock-csrf-token-a1b2c3'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const latency = () => sleep(120 + Math.random() * 180)

function authed(): boolean {
  return localStorage.getItem(AUTHED_KEY) === '1'
}

function requireAuth() {
  if (!authed()) throw new ApiError(401, 'unauthenticated', 'Not logged in')
}

function notFound(what: string): never {
  throw new ApiError(404, 'not_found', `${what} not found`)
}

function baselineScenario(): Scenario {
  return { id: 0, name: 'Current trajectory', description: 'Your plan as entered — no changes.', is_baseline: true, params: {} }
}

function simulate(params: ScenarioParams, nPaths: number, seed: number) {
  return runMockSim({
    profile: db.profile,
    accounts: db.accounts,
    flows: db.flows,
    params,
    nPaths: Math.min(Math.max(nPaths, 100), 2000),
    seed,
  })
}

function scenarioById(id: number): Scenario {
  if (id === 0) return baselineScenario()
  return db.scenarios.find((s) => s.id === id) ?? notFound('scenario')
}

function dashboard(): DashboardData {
  let assets = 0
  let liabilities = 0
  const byType: Record<string, number> = {}
  for (const a of db.accounts) {
    if (!a.include_in_net_worth) continue
    byType[a.type] = (byType[a.type] ?? 0) + a.balance
    if (LIABILITY_TYPES.includes(a.type)) liabilities += a.balance
    else assets += a.balance
  }
  let income = 0
  let outgo = 0
  for (const f of db.flows) {
    if (f.kind === 'income') income += f.amount_monthly
    else outgo += f.amount_monthly
  }
  return {
    net_worth: assets - liabilities,
    assets,
    liabilities,
    history: db.netWorthHistory(),
    by_type: byType as DashboardData['by_type'],
    goals_summary: db.goals,
    monthly_surplus: Math.round((income - outgo) * 100) / 100,
  }
}

/* ------------------------------- import --------------------------------- */

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

async function importPreview(form: FormData): Promise<ImportPreview> {
  const file = form.get('file')
  const kind = form.get('kind')
  if (!(file instanceof File)) throw new ApiError(400, 'bad_request', 'file is required')
  const text = await file.text()
  if (kind === 'ofx') {
    const count = (text.match(/<STMTTRN>/gi) ?? []).length
    const balMatch = /<BALAMT>([-\d.]+)/i.exec(text)
    const acctMatch = /<ACCTID>(\w+)/i.exec(text)
    return {
      accounts_found: acctMatch ? [`···${acctMatch[1]!.slice(-4)}`] : ['unknown'],
      transaction_count: count,
      balance: balMatch ? Number(balMatch[1]) : 0,
    }
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw new ApiError(400, 'empty_file', 'No data rows found')
  const columns = splitCsvLine(lines[0]!)
  const sample_rows = lines.slice(1, 9).map(splitCsvLine)
  const suggested: Partial<CsvMapping> = {}
  for (const col of columns) {
    const c = col.toLowerCase()
    if (!suggested.date && /date|posted/.test(c)) suggested.date = col
    else if (!suggested.amount && /amount|amt|value/.test(c)) suggested.amount = col
    else if (!suggested.payee && /payee|description|merchant|name/.test(c)) suggested.payee = col
    else if (!suggested.category && /category|type/.test(c)) suggested.category = col
  }
  return { columns, sample_rows, suggested_mapping: suggested }
}

async function importCommit(form: FormData) {
  const file = form.get('file')
  const accountId = Number(form.get('account_id'))
  const kind = form.get('kind')
  const mappingRaw = form.get('mapping')
  if (!(file instanceof File)) throw new ApiError(400, 'bad_request', 'file is required')
  const text = await file.text()
  let rows: { date: string; amount: number; payee: string; category: string }[] = []

  if (kind === 'csv') {
    const mapping = JSON.parse(String(mappingRaw ?? '{}')) as CsvMapping
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
    const columns = splitCsvLine(lines[0]!)
    const idx = (name?: string) => (name ? columns.indexOf(name) : -1)
    const di = idx(mapping.date)
    const ai = idx(mapping.amount)
    const pi = idx(mapping.payee)
    const ci = idx(mapping.category)
    if (di < 0 || ai < 0) throw new ApiError(400, 'bad_mapping', 'date and amount columns are required')
    rows = lines.slice(1).map((l) => {
      const cells = splitCsvLine(l)
      return {
        date: normalizeDate(cells[di] ?? ''),
        amount: Number((cells[ai] ?? '0').replace(/[$,]/g, '')) || 0,
        payee: pi >= 0 ? (cells[pi] ?? '') : '',
        category: ci >= 0 ? (cells[ci] ?? '') : '',
      }
    })
  } else {
    const blocks = text.split(/<STMTTRN>/i).slice(1)
    rows = blocks.map((b) => ({
      date: normalizeDate(/<DTPOSTED>(\d{8})/i.exec(b)?.[1] ?? ''),
      amount: Number(/<TRNAMT>([-\d.]+)/i.exec(b)?.[1] ?? 0),
      payee: /<NAME>([^<\r\n]+)/i.exec(b)?.[1]?.trim() ?? '',
      category: '',
    }))
  }

  const seen = new Set(
    db.transactions
      .filter((t) => t.account_id === accountId)
      .map((t) => `${t.date}|${t.amount}|${t.payee}`),
  )
  let imported = 0
  let skipped = 0
  for (const r of rows) {
    const key = `${r.date}|${r.amount}|${r.payee}`
    if (seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    db.transactions.unshift({ id: db.nextId.transaction++, account_id: accountId, ...r })
    imported++
  }
  if (form.get('update_balance') === 'true') {
    const acct = db.accounts.find((a) => a.id === accountId)
    if (acct && rows.length > 0) {
      const delta = rows.reduce((s, r) => s + r.amount, 0)
      setBalance(acct, Math.round((acct.balance + delta) * 100) / 100)
    }
  }
  return { imported, skipped_duplicates: skipped }
}

function normalizeDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{8}/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw)
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!
    return `${y}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`
  }
  return raw
}

function setBalance(acct: Account, amount: number) {
  acct.balance = amount
  const snaps = db.balances.get(acct.id) ?? []
  const today = todayISO()
  const existing = snaps.find((s) => s.date === today)
  if (existing) existing.amount = amount
  else snaps.push({ date: today, amount })
  db.balances.set(acct.id, snaps)
}

/* -------------------------------- router -------------------------------- */

export async function mockRequest<T>(
  method: string,
  path: string,
  json?: unknown,
  form?: FormData,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  await latency()
  const r = route(method, path, json, form, query)
  return (await r) as T
}

async function route(
  method: string,
  path: string,
  json?: unknown,
  form?: FormData,
  query?: Record<string, string | number | undefined>,
): Promise<unknown> {
  const key = `${method} ${path}`
  const body = json as Record<string, never> & Record<string, unknown>

  /* ---- auth (no session required) ---- */
  if (key === 'GET /auth/session') {
    const info: SessionInfo = {
      authenticated: authed(),
      setup_required: localStorage.getItem(PW_KEY) === null,
    }
    if (info.authenticated) info.csrf_token = CSRF
    return info
  }
  if (key === 'POST /auth/setup') {
    if (localStorage.getItem(PW_KEY) !== null)
      throw new ApiError(409, 'already_setup', 'Password already set')
    const pw = String(body?.password ?? '')
    if (pw.length < 10) throw new ApiError(400, 'weak_password', 'Password must be at least 10 characters')
    localStorage.setItem(PW_KEY, pw)
    return undefined
  }
  if (key === 'POST /auth/login') {
    const pw = String(body?.password ?? '')
    if (pw !== localStorage.getItem(PW_KEY))
      throw new ApiError(401, 'invalid_credentials', 'Wrong password')
    localStorage.setItem(AUTHED_KEY, '1')
    return { csrf_token: CSRF }
  }
  if (key === 'POST /auth/logout') {
    localStorage.removeItem(AUTHED_KEY)
    return undefined
  }

  requireAuth()

  /* ---- profile ---- */
  if (key === 'GET /profile') return db.profile
  if (key === 'PUT /profile') return Object.assign(db.profile, body)

  /* ---- accounts ---- */
  if (key === 'GET /accounts') return db.accounts
  if (key === 'POST /accounts') {
    const a: Account = {
      id: db.nextId.account++,
      name: '',
      type: 'checking',
      institution: '',
      balance: 0,
      growth_rate_pct: null,
      asset_class: null,
      include_in_net_worth: true,
      notes: '',
      created_at: todayISO(),
      ...(body as object),
    }
    db.accounts.push(a)
    db.balances.set(a.id, [{ date: todayISO(), amount: a.balance }])
    return a
  }
  let m = /^\/accounts\/(\d+)$/.exec(path)
  if (m) {
    const acct = db.accounts.find((a) => a.id === Number(m![1])) ?? notFound('account')
    if (method === 'GET') return acct
    if (method === 'DELETE') {
      db.accounts.splice(db.accounts.indexOf(acct), 1)
      return undefined
    }
    if (method === 'PATCH') {
      const patch = body as Partial<Account>
      if (typeof patch.balance === 'number') setBalance(acct, patch.balance)
      const { balance: _b, ...rest } = patch
      return Object.assign(acct, rest)
    }
  }
  m = /^\/accounts\/(\d+)\/balances$/.exec(path)
  if (m) {
    const id = Number(m[1])
    const acct = db.accounts.find((a) => a.id === id) ?? notFound('account')
    const snaps = db.balances.get(id) ?? []
    if (method === 'GET') return [...snaps].sort((a, b) => (a.date < b.date ? -1 : 1))
    if (method === 'POST') {
      const snap = body as unknown as BalanceSnapshot
      const existing = snaps.find((s) => s.date === snap.date)
      if (existing) existing.amount = snap.amount
      else snaps.push({ ...snap })
      db.balances.set(id, snaps)
      const latest = [...snaps].sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1)
      if (latest) acct.balance = latest.amount
      return snap
    }
  }
  m = /^\/accounts\/(\d+)\/balances\/(\d{4}-\d{2}-\d{2})$/.exec(path)
  if (m && method === 'DELETE') {
    const id = Number(m[1])
    const acct = db.accounts.find((a) => a.id === id) ?? notFound('account')
    const snaps = (db.balances.get(id) ?? []).filter((s) => s.date !== m![2])
    db.balances.set(id, snaps)
    const latest = [...snaps].sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1)
    if (latest) acct.balance = latest.amount
    return undefined
  }

  /* ---- flows ---- */
  if (key === 'GET /flows') return db.flows
  if (key === 'POST /flows') {
    const f = { id: db.nextId.flow++, ...(body as object) } as Flow
    db.flows.push(f)
    return f
  }
  m = /^\/flows\/(\d+)$/.exec(path)
  if (m) {
    const f = db.flows.find((x) => x.id === Number(m![1])) ?? notFound('flow')
    if (method === 'PATCH') return Object.assign(f, body)
    if (method === 'DELETE') {
      db.flows.splice(db.flows.indexOf(f), 1)
      return undefined
    }
  }

  /* ---- goals ---- */
  if (key === 'GET /goals') return db.goals
  if (key === 'POST /goals') {
    const g = { id: db.nextId.goal++, ...(body as object) } as Goal
    db.goals.push(g)
    return g
  }
  m = /^\/goals\/(\d+)$/.exec(path)
  if (m) {
    const g = db.goals.find((x) => x.id === Number(m![1])) ?? notFound('goal')
    if (method === 'PATCH') return Object.assign(g, body)
    if (method === 'DELETE') {
      db.goals.splice(db.goals.indexOf(g), 1)
      return undefined
    }
  }

  /* ---- transactions ---- */
  if (key === 'GET /transactions') {
    let out = db.transactions
    const accountId = query?.account_id
    if (accountId !== undefined) out = out.filter((t) => t.account_id === Number(accountId))
    if (query?.from) out = out.filter((t) => t.date >= String(query.from))
    if (query?.to) out = out.filter((t) => t.date <= String(query.to))
    const limit = Number(query?.limit ?? 200)
    return out.slice(0, limit)
  }

  /* ---- import ---- */
  if (key === 'POST /import/preview') return importPreview(form!)
  if (key === 'POST /import/commit') return importCommit(form!)

  /* ---- scenarios ---- */
  if (key === 'GET /scenarios') return [baselineScenario(), ...db.scenarios]
  if (key === 'POST /scenarios') {
    const s: Scenario = {
      id: db.nextId.scenario++,
      name: 'Untitled scenario',
      description: '',
      is_baseline: false,
      params: {},
      ...(body as object),
    }
    db.scenarios.push(s)
    return s
  }
  m = /^\/scenarios\/(\d+)$/.exec(path)
  if (m) {
    const id = Number(m[1])
    if (method === 'GET') return scenarioById(id)
    if (id === 0) throw new ApiError(400, 'baseline_readonly', 'The baseline scenario is read-only')
    const s = db.scenarios.find((x) => x.id === id) ?? notFound('scenario')
    if (method === 'PATCH') return Object.assign(s, body)
    if (method === 'DELETE') {
      db.scenarios.splice(db.scenarios.indexOf(s), 1)
      return undefined
    }
  }
  if (key === 'POST /scenarios/compare') {
    const req = body as unknown as { scenario_ids: number[]; n_paths?: number; seed?: number }
    const results = req.scenario_ids.map((id) => {
      const s = scenarioById(id)
      const sim = simulate(s.params, req.n_paths ?? 1000, req.seed ?? 42)
      return { scenario_id: id, name: s.name, ...sim }
    })
    return { results } satisfies CompareResult
  }

  /* ---- simulate ---- */
  if (key === 'POST /simulate') {
    const req = body as unknown as SimulateRequest
    const params = 'scenario_id' in req ? scenarioById(req.scenario_id).params : req.params
    return simulate(params, req.n_paths ?? 1000, req.seed ?? 42)
  }

  /* ---- dashboard & settings ---- */
  if (key === 'GET /dashboard') return dashboard()
  if (key === 'GET /settings') return db.settings
  if (key === 'PATCH /settings') return Object.assign(db.settings, body)

  throw new ApiError(404, 'not_found', `No mock route for ${key}`)
}

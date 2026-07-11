/** Mock API router for VITE_MOCK=1 — faithful to docs/API.md shapes and
 * status codes so swapping to the real backend is a config change. */

import { ApiError } from '../client'
import type {
  Account,
  AccountGroup,
  AccountMap,
  AiSettings,
  AiSettingsUpdate,
  AiUsageMonth,
  BalanceSnapshot,
  CategoryRule,
  CompareResult,
  CsvMapping,
  DashboardData,
  Flow,
  Goal,
  HouseholdMember,
  ImportAccountResult,
  ImportCommitResult,
  ImportPreview,
  NewAccountPayload,
  ObservedSpending,
  Scenario,
  ScenarioParams,
  SessionInfo,
  SimulateRequest,
  SpendingCategory,
  SpendingProfileInput,
  TransferCandidate,
} from '../types'
import { LIABILITY_TYPES } from '../types'
import * as db from './db'
import {
  detectRecurring,
  forecast,
  freshnessOf,
  hotspots,
  spendingSummary,
  suggestCategories,
} from './analytics'
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

function validateClaimAge(age: number | null | undefined) {
  if (age != null && (age < 62 || age > 70))
    throw new ApiError(400, 'invalid_claim_age', 'ss_claim_age must be between 62 and 70')
}

function aiSettings(): AiSettings {
  return {
    has_api_key: db.aiState.api_key !== null,
    api_key_last4: db.aiState.api_key ? db.aiState.api_key.slice(-4) : null,
    enabled: db.aiState.enabled,
    monthly_budget_usd: db.aiState.monthly_budget_usd,
    spend_this_month_usd: 0,
    tokens_this_month: { input: 0, output: 0 },
  }
}

function baselineScenario(): Scenario {
  return { id: 0, name: 'Current trajectory', description: 'Your plan as entered — no changes.', is_baseline: true, params: {} }
}

/** #8: replays REAL-engine golden fixtures for the demo household (see
 * mock/sim.ts). n_paths/seed are pinned into the fixtures, so the request's
 * values no longer steer the dynamics. */
function simulate(params: ScenarioParams) {
  return runMockSim(params)
}

function scenarioById(id: number): Scenario {
  if (id === 0) return baselineScenario()
  return db.scenarios.find((s) => s.id === id) ?? notFound('scenario')
}

/** Accounts are served with computed freshness (never trust stored value). */
function serveAccount(a: Account): Account {
  return { ...a, freshness: freshnessOf(a).freshness }
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
  // v1.1: spending categories count as outgo alongside expense flows.
  for (const c of db.spendingProfile.categories) outgo += c.monthly_amount
  return {
    net_worth: assets - liabilities,
    assets,
    liabilities,
    history: db.netWorthHistory(),
    by_type: byType as DashboardData['by_type'],
    goals_summary: db.goals.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      target_amount: g.target_amount,
      funded_amount: g.funded_amount,
      target_date: g.target_date,
      priority: g.priority,
      pct_funded: g.target_amount ? Math.round((1000 * g.funded_amount) / g.target_amount) / 10 : 0,
    })),
    monthly_surplus: Math.round((income - outgo) * 100) / 100,
    // v1.2: aging + stale only
    stale_accounts: db.accounts
      .map((a) => ({ a, f: freshnessOf(a) }))
      .filter(({ f }) => f.freshness === 'aging' || f.freshness === 'stale')
      .map(({ a, f }) => ({
        id: a.id,
        name: a.name,
        freshness: f.freshness,
        days_since_import: f.days_since_import,
      })),
  }
}

/* --------------------------- observed spending --------------------------- */

/** Trailing-N-months outflow averages from imported transactions, grouped by
 * category (uncategorized → "uncategorized"). Computed on demand, never stored. */
function observedSpending(monthsRaw: number): ObservedSpending {
  const months = Math.min(60, Math.max(1, Number.isFinite(monthsRaw) ? Math.round(monthsRaw) : 12))
  const cutoff = new Date()
  cutoff.setDate(1)
  cutoff.setMonth(cutoff.getMonth() - months)
  const from = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-01`
  const to = todayISO()

  const sums = new Map<string, { total: number; count: number }>()
  for (const t of db.transactions) {
    // v1.2: transfer-paired transactions are excluded from ALL analytics;
    // #26: investment-activity rows likewise (reinvestments are not spending)
    if (t.transfer_pair_id !== null) continue
    if (t.category === INVESTMENT_ACTIVITY_CATEGORY) continue
    if (t.amount >= 0 || t.date < from || t.date > to) continue
    const key = t.category.trim() || 'uncategorized'
    const cur = sums.get(key) ?? { total: 0, count: 0 }
    cur.total += -t.amount
    cur.count += 1
    sums.set(key, cur)
  }
  const by_category = [...sums.entries()]
    .map(([category, { total, count }]) => ({
      category,
      monthly_avg: Math.round((total / months) * 100) / 100,
      txn_count: count,
    }))
    .sort((a, b) => b.monthly_avg - a.monthly_avg)
  const total = by_category.reduce((s, c) => s + c.monthly_avg, 0)
  return {
    months,
    from,
    to,
    total_monthly_avg: Math.round(total * 100) / 100,
    by_category,
  }
}

/* ------------------------------- import --------------------------------- */

/** Full-stream CSV parser (#26): quoted fields may contain commas, escaped
 * quotes ("") and EMBEDDED NEWLINES (real Amex exports) — nothing may split
 * on physical lines first. Blank rows drop; leading non-CSV preamble rows
 * (fewer than 2 non-empty cells) drop so the header is the first row. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  const endCell = () => {
    row.push(cur.trim())
    cur = ''
  }
  const endRow = () => {
    endCell()
    if (row.some((c) => c)) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') endCell()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else cur += ch
  }
  endRow()
  const start = rows.findIndex((r) => r.filter((c) => c).length >= 2)
  return start > 0 ? rows.slice(start) : rows
}

const SIGN_HINT_TYPES = ['credit_card', 'loan', 'mortgage']

function suggestedMapping(columns: string[], dataRows: string[][]): Partial<CsvMapping> {
  // #26: never propose a fully-empty column for any role
  const usable = columns.filter((_, i) => dataRows.some((r) => (r[i] ?? '').trim()))
  const suggested: Partial<CsvMapping> = {}
  const exact = (name: string) => usable.find((c) => c.trim().toLowerCase() === name)
  // Fidelity-style "Action" is the payee; Citi-style "Status" marks pending
  const action = exact('action')
  if (action) suggested.payee = action
  const status = exact('status')
  if (status) suggested.status_column = status
  for (const col of usable) {
    const c = col.toLowerCase()
    if (!suggested.date && /date|posted/.test(c)) suggested.date = col
    else if (!suggested.amount && /amount|amt|value/.test(c)) suggested.amount = col
    else if (!suggested.payee && /payee|description|merchant|name/.test(c)) suggested.payee = col
    else if (!suggested.category && /category|type/.test(c)) suggested.category = col
  }
  if (!suggested.amount) {
    // v1.2.2: split debit/credit columns (a column matching both — e.g.
    // "Debit/Credit" — would be a single amount column, handled above)
    const debit = usable.find((c) => /debit|withdrawal|money out|charge/.test(c.toLowerCase()) && !/credit|deposit|money in/.test(c.toLowerCase()))
    const credit = usable.find((c) => /credit|deposit|money in/.test(c.toLowerCase()) && !/debit|withdrawal|money out|charge/.test(c.toLowerCase()))
    if (debit && credit) {
      suggested.debit = debit
      suggested.credit = credit
    }
  }
  // #26 multi-account detection: an account-number-ish column whose values
  // repeat across rows with more than one distinct value
  const idCol = usable.find((c) => /account number|account no|account #|acct number|account id/.test(c.toLowerCase()))
  if (idCol) {
    const i = columns.indexOf(idCol)
    const values = new Set(dataRows.map((r) => (r[i] ?? '').trim()).filter(Boolean))
    if (values.size > 1 && values.size < dataRows.length) {
      suggested.account_id_column = idCol
      const nameCol = usable.find((c) => c.trim().toLowerCase() === 'account' || /account name/.test(c.toLowerCase()))
      if (nameCol) suggested.account_column = nameCol
    }
  }
  return suggested
}

function rowAmount(cells: string[], columns: string[], mapping: Partial<CsvMapping>): number | null {
  const idx = (name?: string) => (name ? columns.indexOf(name) : -1)
  const num = (raw: string) => {
    const cleaned = raw.replace(/[$,]/g, '').trim()
    return cleaned === '' ? null : Number(cleaned)
  }
  if (mapping.debit && mapping.credit) {
    const debit = num(cells[idx(mapping.debit)] ?? '')
    const credit = num(cells[idx(mapping.credit)] ?? '')
    if (debit === null && credit === null) return null
    // #26 role-based signs: each side is an ABSOLUTE value — debit = outflow,
    // credit = inflow (Citi lists credits already negative)
    return Math.abs(credit ?? 0) - Math.abs(debit ?? 0)
  }
  const v = num(cells[idx(mapping.amount)] ?? '')
  return v !== null && Number.isFinite(v) ? v : null
}

/** #26: collapse consecutive whitespace — padded exports fragment analytics. */
function normalizePayee(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function isPending(cells: string[], columns: string[], mapping: Partial<CsvMapping>): boolean {
  if (!mapping.status_column) return false
  const i = columns.indexOf(mapping.status_column)
  return i >= 0 && (cells[i] ?? '').trim().toLowerCase() === 'pending'
}

const INVESTMENT_TYPES = ['brokerage', 'retirement', 'hsa']
export const INVESTMENT_ACTIVITY_CATEGORY = 'investment-activity'

/** #26: served last_account_id is a loose reference — null once the account
 * it names is gone. */
function liveLastAccountId(preset: { last_account_id: number | null }): number | null {
  if (preset.last_account_id === null) return null
  return db.accounts.some((a) => a.id === preset.last_account_id)
    ? preset.last_account_id
    : null
}

function accountGroups(
  columns: string[],
  dataRows: string[][],
  mapping: Partial<CsvMapping>,
): AccountGroup[] | null {
  if (!mapping.account_id_column) return null
  const idIdx = columns.indexOf(mapping.account_id_column)
  const nameIdx = mapping.account_column ? columns.indexOf(mapping.account_column) : -1
  const groups = new Map<string, AccountGroup>()
  for (const cells of dataRows) {
    if (isPending(cells, columns, mapping)) continue
    const raw = (cells[idIdx] ?? '').trim()
    if (!raw) continue
    const key = db.externalIdHash(raw)
    const existing = groups.get(key)
    if (existing) {
      existing.rows += 1
      if (!existing.name && nameIdx >= 0) existing.name = (cells[nameIdx] ?? '').trim() || null
    } else {
      groups.set(key, {
        key,
        number_masked: `···${raw.slice(-4)}`,
        name: nameIdx >= 0 ? (cells[nameIdx] ?? '').trim() || null : null,
        rows: 1,
        account_id: db.externalLinks.get(key) ?? null,
      })
    }
  }
  const out = [...groups.values()]
  return out.length > 0 ? out : null
}

async function importPreview(form: FormData): Promise<ImportPreview> {
  const file = form.get('file')
  const kind = form.get('kind')
  if (!(file instanceof File)) throw new ApiError(400, 'bad_request', 'file is required')
  const text = await file.text()
  if (kind === 'ofx') {
    const count = (text.match(/<STMTTRN>/gi) ?? []).length
    const balMatch = /<BALAMT>([-\d.]+)/i.exec(text)
    const acctMatch = /<ACCTID>([^<\r\n]+)/i.exec(text)
    const acctid = acctMatch?.[1]?.trim() ?? null
    return {
      accounts_found: acctid ? [acctid] : [],
      transaction_count: count,
      balance: balMatch ? Number(balMatch[1]) : 0,
      // #26: matched by hashed ACCTID
      account_match: {
        account_id: acctid ? (db.externalLinks.get(db.externalIdHash(acctid)) ?? null) : null,
        acctid_masked: acctid ? `···${acctid.slice(-4)}` : null,
      },
    }
  }
  const rows = parseCsv(text)
  if (rows.length < 2) throw new ApiError(400, 'empty_file', 'No data rows found')
  const columns = rows[0]!
  const dataRows = rows.slice(1)
  // contract ruling 2026-07-10: rows are {column: value} objects
  const sample_rows = dataRows.slice(0, 8).map((cells) => {
    const row: Record<string, string> = {}
    columns.forEach((c, i) => {
      row[c] = cells[i] ?? ''
    })
    return row
  })
  const suggested = suggestedMapping(columns, dataRows)

  // v1.2.2 (T-009): preset match by header fingerprint + sign-convention hint
  const preset = db.importPresets.find((p) => p.header_fingerprint === db.fingerprintOf(columns))
  const matched_preset = preset
    ? {
        id: preset.id,
        name: preset.name,
        mapping: preset.mapping,
        flip_signs: preset.flip_signs,
        last_account_id: liveLastAccountId(preset),
      }
    : null

  // #26: an explicit mapping override wins (the wizard re-previews after
  // remapping), then the matched preset, then the suggestion
  const overrideRaw = form.get('mapping')
  const effective: Partial<CsvMapping> = overrideRaw
    ? (JSON.parse(String(overrideRaw)) as Partial<CsvMapping>)
    : (preset?.mapping ?? suggested)

  let sign_hint: { looks_flipped: boolean; reason: string } | null = null
  const account = db.accounts.find((a) => a.id === Number(form.get('account_id')))
  if (account && SIGN_HINT_TYPES.includes(account.type) && !(effective.debit && effective.credit)) {
    const amounts = dataRows
      .filter((cells) => !isPending(cells, columns, effective))
      .map((cells) => rowAmount(cells, columns, effective))
      .filter((v): v is number => v !== null && Number.isFinite(v))
    const positive = amounts.filter((v) => v > 0).length
    if (amounts.length > 0 && positive / amounts.length > 0.8) {
      const label = account.type === 'credit_card' ? 'credit card' : account.type
      sign_hint = {
        looks_flipped: true,
        reason: `${positive} of ${amounts.length} rows look like charges, but they are positive — this ${label} export probably lists charges as positive numbers. Flipping signs stores charges as money out.`,
      }
    }
  }

  const pending_rows = effective.status_column
    ? dataRows.filter((cells) => isPending(cells, columns, effective)).length
    : null

  return {
    columns,
    sample_rows,
    suggested_mapping: suggested,
    matched_preset,
    sign_hint,
    account_groups: accountGroups(columns, dataRows, effective),
    pending_rows,
  }
}

function createImportAccount(payload: NewAccountPayload): Account {
  const a: Account = {
    id: db.nextId.account++,
    name: payload.name,
    type: payload.type,
    institution: payload.institution ?? '',
    balance: 0,
    growth_rate_pct: null,
    asset_class: payload.asset_class ?? null,
    member_id: payload.member_id ?? null,
    include_in_net_worth: true,
    notes: '',
    created_at: todayISO(),
    last_import_at: null,
    newest_transaction_date: null,
    staleness_days: null,
    track_freshness: db.TRACK_FRESHNESS_DEFAULT.includes(payload.type),
    freshness: 'never',
  }
  db.accounts.push(a)
  db.balances.set(a.id, [{ date: todayISO(), amount: 0 }])
  return a
}

interface ParsedRow {
  date: string
  amount: number
  payee: string
  category: string
  accountKey: string | null
  accountName: string | null
  accountMasked: string | null
}

/** Insert rows into one account: dedupe, categorization (#26 investment
 * ruling), freshness bookkeeping. */
function importRowsInto(account: Account, rows: ParsedRow[]): { imported: number; skipped: number } {
  const seen = new Set(
    db.transactions
      .filter((t) => t.account_id === account.id)
      .map((t) => `${t.date}|${t.amount}|${t.payee}`),
  )
  const investment = INVESTMENT_TYPES.includes(account.type)
  let imported = 0
  let skipped = 0
  for (const r of rows) {
    const key = `${r.date}|${r.amount}|${r.payee}`
    if (seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    // #26 rulings: investment accounts categorize investment-activity;
    // file-supplied categories are heuristic-grade (never manual)
    const category = investment ? INVESTMENT_ACTIVITY_CATEGORY : r.category
    db.transactions.unshift({
      id: db.nextId.transaction++,
      account_id: account.id,
      transfer_pair_id: null,
      category,
      category_source: category ? 'heuristic' : 'none',
      date: r.date,
      amount: r.amount,
      payee: r.payee,
    })
    imported++
  }
  account.last_import_at = `${todayISO()}T00:00:00`
  account.newest_transaction_date = rows.reduce<string | null>(
    (mx, r) => (mx && mx >= r.date ? mx : r.date),
    account.newest_transaction_date,
  )
  return { imported, skipped }
}

async function importCommit(form: FormData): Promise<ImportCommitResult> {
  const file = form.get('file')
  const kind = form.get('kind')
  const mappingRaw = form.get('mapping')
  if (!(file instanceof File)) throw new ApiError(400, 'bad_request', 'file is required')
  const text = await file.text()
  let rows: ParsedRow[] = []
  let skippedPending = 0
  let mapping: Partial<CsvMapping> = {}
  let ofxAcctid: string | null = null
  let columns: string[] = []

  if (kind === 'csv') {
    mapping = JSON.parse(String(mappingRaw ?? '{}')) as CsvMapping
    const flipSigns = form.get('flip_signs') === 'true'
    const parsed = parseCsv(text)
    columns = parsed[0] ?? []
    const idx = (name?: string) => (name ? columns.indexOf(name) : -1)
    const di = idx(mapping.date)
    const pi = idx(mapping.payee)
    const ci = idx(mapping.category)
    const ai = idx(mapping.account_id_column)
    const ni = idx(mapping.account_column)
    const split = !!(mapping.debit && mapping.credit)
    if (di < 0 || (!split && idx(mapping.amount) < 0))
      throw new ApiError(400, 'bad_mapping', 'date and amount columns are required')
    for (const cells of parsed.slice(1)) {
      // #26 Citi ruling: pending rows are skipped entirely
      if (isPending(cells, columns, mapping)) {
        skippedPending++
        continue
      }
      const amount = rowAmount(cells, columns, mapping)
      const date = normalizeDate(cells[di] ?? '')
      // trailing-summary tolerance: rows without a parseable date+amount
      // are dropped (the real server only tolerates a trailing block)
      if (amount === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const rawNumber = ai >= 0 ? (cells[ai] ?? '').trim() : ''
      rows.push({
        date,
        amount: flipSigns ? -amount : amount,
        payee: normalizePayee(pi >= 0 ? (cells[pi] ?? '') : ''),
        category: ci >= 0 ? (cells[ci] ?? '').trim() : '',
        accountKey: rawNumber ? db.externalIdHash(rawNumber) : null,
        accountName: ni >= 0 ? (cells[ni] ?? '').trim() || null : null,
        accountMasked: rawNumber ? `···${rawNumber.slice(-4)}` : null,
      })
    }

    // v1.2.2 (T-009): save_preset upserts by header fingerprint
    const presetName = String(form.get('save_preset') ?? '').trim()
    if (presetName) {
      const fp = db.fingerprintOf(columns)
      const existing = db.importPresets.find((p) => p.header_fingerprint === fp)
      if (existing) {
        existing.name = presetName
        existing.mapping = mapping
        existing.flip_signs = flipSigns
      } else {
        db.importPresets.push({
          id: db.nextId.importPreset++,
          name: presetName,
          header_fingerprint: fp,
          mapping,
          flip_signs: flipSigns,
          created_at: `${todayISO()}T00:00:00`,
          last_account_id: null,
        })
      }
    }
  } else {
    ofxAcctid = /<ACCTID>([^<\r\n]+)/i.exec(text)?.[1]?.trim() ?? null
    const blocks = text.split(/<STMTTRN>/i).slice(1)
    rows = blocks.map((b) => ({
      date: normalizeDate(/<DTPOSTED>(\d{8})/i.exec(b)?.[1] ?? ''),
      amount: Number(/<TRNAMT>([-\d.]+)/i.exec(b)?.[1] ?? 0),
      payee: normalizePayee(/<NAME>([^<\r\n]+)/i.exec(b)?.[1] ?? ''),
      category: '',
      accountKey: null,
      accountName: null,
      accountMasked: null,
    }))
  }

  const multi = kind === 'csv' && !!mapping.account_id_column
  const accountIdRaw = form.get('account_id')
  const newAccountRaw = form.get('new_account')

  if (multi) {
    if (accountIdRaw !== null || newAccountRaw !== null)
      throw new ApiError(422, 'validation_error', 'multi-account imports route by account_map')
    const accountMap = JSON.parse(String(form.get('account_map') ?? '{}')) as AccountMap
    const order: string[] = []
    const groups = new Map<string, ParsedRow[]>()
    for (const r of rows) {
      if (!r.accountKey)
        throw new ApiError(422, 'validation_error', 'a dated row is missing its account number')
      if (!groups.has(r.accountKey)) {
        order.push(r.accountKey)
        groups.set(r.accountKey, [])
      }
      groups.get(r.accountKey)!.push(r)
    }
    // resolve every group before writing anything (fail closed)
    const resolved = new Map<string, { account: Account; created: boolean }>()
    const unknown: string[] = []
    for (const key of order) {
      const entry = accountMap[key]
      if (entry && 'account_id' in entry) {
        const acc = db.accounts.find((a) => a.id === entry.account_id)
        if (!acc) notFound('account')
        db.externalLinks.set(key, acc.id)
        resolved.set(key, { account: acc, created: false })
      } else if (entry && 'new_account' in entry) {
        const acc = createImportAccount(entry.new_account)
        db.externalLinks.set(key, acc.id)
        resolved.set(key, { account: acc, created: true })
      } else {
        const linked = db.externalLinks.get(key)
        const acc = db.accounts.find((a) => a.id === linked)
        if (acc) resolved.set(key, { account: acc, created: false })
        else unknown.push(groups.get(key)![0]!.accountMasked ?? key)
      }
    }
    if (unknown.length > 0)
      throw new ApiError(
        422, 'unknown_account',
        `no account is linked to ${unknown.join(', ')} — map each to an existing account or create new ones`,
      )
    const accounts: ImportAccountResult[] = []
    let imported = 0
    let skipped = 0
    for (const key of order) {
      const { account, created } = resolved.get(key)!
      const result = importRowsInto(account, groups.get(key)!)
      imported += result.imported
      skipped += result.skipped
      accounts.push({
        account_id: account.id,
        name: account.name,
        created,
        imported: result.imported,
        skipped_duplicates: result.skipped,
      })
    }
    return { imported, skipped_duplicates: skipped, skipped_pending: skippedPending, accounts }
  }

  // single-target mode: exactly one of account_id / new_account (#26)
  if ((accountIdRaw === null) === (newAccountRaw === null))
    throw new ApiError(422, 'validation_error', 'provide exactly one of account_id or new_account')
  let account: Account
  let created = false
  if (newAccountRaw !== null) {
    account = createImportAccount(JSON.parse(String(newAccountRaw)) as NewAccountPayload)
    created = true
  } else {
    account = db.accounts.find((a) => a.id === Number(accountIdRaw)) ?? notFound('account')
  }

  // #26: hashed external-account link for OFX (last-write-wins)
  if (ofxAcctid) db.externalLinks.set(db.externalIdHash(ofxAcctid), account.id)

  const { imported, skipped } = importRowsInto(account, rows)

  if (form.get('update_balance') === 'true' && rows.length > 0) {
    const delta = rows.reduce((s, r) => s + r.amount, 0)
    setBalance(account, Math.round((account.balance + delta) * 100) / 100)
  }

  // #26: single-target CSV commits remember the target on the matched preset
  if (kind === 'csv' && columns.length > 0) {
    const preset = db.importPresets.find((p) => p.header_fingerprint === db.fingerprintOf(columns))
    if (preset) preset.last_account_id = account.id
  }

  const result: ImportCommitResult = {
    imported,
    skipped_duplicates: skipped,
    skipped_pending: skippedPending,
  }
  if (created) result.account = serveAccount(account)
  return result
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
  const r = await route(method, path, json, form, query)
  // Clone like a real wire: handlers return live references into the mock db;
  // handing those to React Query lets in-place mutations alias the cache and
  // suppress re-renders (fresh objects per response, like JSON over HTTP).
  return (r === undefined ? undefined : structuredClone(r)) as T
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

  /* ---- household (v1.1) ---- */
  if (key === 'GET /household') return db.household
  if (key === 'POST /household') {
    const m: HouseholdMember = {
      id: db.nextId.member++,
      name: '',
      role: 'other',
      birth_year: 1990,
      life_expectancy: 90,
      retirement_age: null,
      ss_monthly_at_fra: null,
      ss_claim_age: null,
      notes: '',
      ...(body as object),
    }
    if (m.role === 'self' && db.household.some((x) => x.role === 'self'))
      throw new ApiError(400, 'exactly_one_self', 'Exactly one self member must exist')
    validateClaimAge(m.ss_claim_age)
    db.household.push(m)
    return m
  }
  let m = /^\/household\/(\d+)$/.exec(path)
  if (m) {
    const member = db.household.find((x) => x.id === Number(m![1])) ?? notFound('household member')
    if (method === 'GET') return member
    if (method === 'PATCH') {
      const patch = body as Partial<HouseholdMember>
      if (patch.role !== undefined && patch.role !== member.role) {
        if (member.role === 'self')
          throw new ApiError(400, 'exactly_one_self', 'The self member must keep the self role')
        if (patch.role === 'self')
          throw new ApiError(400, 'exactly_one_self', 'Exactly one self member must exist')
      }
      if (patch.ss_claim_age !== undefined) validateClaimAge(patch.ss_claim_age)
      return Object.assign(member, patch)
    }
    if (method === 'DELETE') {
      if (member.role === 'self')
        throw new ApiError(400, 'exactly_one_self', 'The self member cannot be deleted')
      db.household.splice(db.household.indexOf(member), 1)
      // Orphaned ownership falls back to household/shared.
      for (const a of db.accounts) if (a.member_id === member.id) a.member_id = null
      for (const f of db.flows) if (f.member_id === member.id) f.member_id = null
      return undefined
    }
  }

  /* ---- spending (v1.1) ---- */
  if (key === 'GET /spending') return db.spendingProfile
  if (key === 'PUT /spending') {
    const input = body as unknown as SpendingProfileInput
    const categories: SpendingCategory[] = (input.categories ?? []).map((c) => ({
      id: c.id && c.id > 0 ? c.id : db.nextId.spendingCategory++,
      name: c.name,
      monthly_amount: c.monthly_amount,
      kind: c.kind,
      annual_growth_pct: c.annual_growth_pct ?? null,
    }))
    db.spendingProfile.categories = categories
    db.spendingProfile.monthly_savings_target = input.monthly_savings_target ?? 0
    return db.spendingProfile
  }
  if (key === 'GET /spending/observed') return observedSpending(Number(query?.months ?? 12))

  /* ---- accounts ---- */
  if (key === 'GET /accounts') return db.accounts.map(serveAccount)
  if (key === 'POST /accounts') {
    const input = body as Partial<Account>
    const type = (input.type ?? 'checking') as Account['type']
    const a: Account = {
      id: db.nextId.account++,
      name: '',
      institution: '',
      balance: 0,
      growth_rate_pct: null,
      asset_class: null,
      member_id: null,
      include_in_net_worth: true,
      notes: '',
      created_at: todayISO(),
      last_import_at: null,
      newest_transaction_date: null,
      staleness_days: null,
      track_freshness: db.TRACK_FRESHNESS_DEFAULT.includes(type),
      freshness: 'never',
      ...(body as object),
      type,
    }
    db.accounts.push(a)
    db.balances.set(a.id, [{ date: todayISO(), amount: a.balance }])
    return serveAccount(a)
  }
  m = /^\/accounts\/(\d+)$/.exec(path)
  if (m) {
    const acct = db.accounts.find((a) => a.id === Number(m![1])) ?? notFound('account')
    if (method === 'GET') return serveAccount(acct)
    if (method === 'DELETE') {
      db.accounts.splice(db.accounts.indexOf(acct), 1)
      return undefined
    }
    if (method === 'PATCH') {
      const patch = body as Partial<Account>
      if (typeof patch.balance === 'number') setBalance(acct, patch.balance)
      const { balance: _b, freshness: _f, ...rest } = patch
      return serveAccount(Object.assign(acct, rest))
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
    const f = { id: db.nextId.flow++, member_id: null, ...(body as object) } as Flow
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
    // v1.2: review queue — uncategorized and not a paired transfer
    if (String(query?.uncategorized ?? '') === '1')
      out = out.filter((t) => t.category.trim() === '' && t.transfer_pair_id === null)
    const limit = Number(query?.limit ?? 200)
    return out.slice(0, limit)
  }
  // v1.2 bulk categorize (source: manual) → {updated} (ruling 2026-07-11)
  if (key === 'POST /transactions/categorize') {
    const req = body as unknown as { ids: number[]; category: string }
    let updated = 0
    for (const t of db.transactions) {
      if (req.ids.includes(t.id)) {
        t.category = req.category
        t.category_source = 'manual'
        updated++
      }
    }
    return { updated }
  }

  /* ---- transfers (v1.2, tombstone rulings 2026-07-11) ---- */
  if (key === 'GET /transfers/candidates') {
    const byId = new Map(db.transactions.map((t) => [t.id, t]))
    const out: TransferCandidate[] = []
    for (const c of db.transferCandidates) {
      const a = byId.get(c.txn_ids[0])
      const b = byId.get(c.txn_ids[1])
      // pairing a leg or tombstoning (dismiss/unpair) retires the candidate
      if (!a || !b || a.transfer_pair_id !== null || b.transfer_pair_id !== null) continue
      if (db.transferTombstones.has(db.tombstoneKey(a.id, b.id))) continue
      out.push({ score: c.score, txns: [a, b] })
    }
    return out.sort((a, b) => b.score - a.score)
  }
  if (key === 'POST /transfers/pair') {
    const req = body as unknown as { transaction_ids: [number, number] }
    const txns = req.transaction_ids.map(
      (id) => db.transactions.find((t) => t.id === id) ?? notFound('transaction'),
    )
    if (txns.some((t) => t.transfer_pair_id !== null))
      throw new ApiError(409, 'already_paired', 'A leg is already part of a transfer pair')
    const pairId = db.nextId.transferPair++
    for (const t of txns) t.transfer_pair_id = pairId
    // manual pairing clears any tombstone for this pair
    db.transferTombstones.delete(db.tombstoneKey(txns[0]!.id, txns[1]!.id))
    return txns
  }
  if (key === 'POST /transfers/candidates/dismiss') {
    const req = body as unknown as { transaction_ids: [number, number] }
    const txns = req.transaction_ids.map(
      (id) => db.transactions.find((t) => t.id === id) ?? notFound('transaction'),
    )
    if (txns.some((t) => t.transfer_pair_id !== null))
      throw new ApiError(409, 'already_paired', 'A leg is already part of a transfer pair')
    db.transferTombstones.add(db.tombstoneKey(txns[0]!.id, txns[1]!.id))
    return undefined // 204 — persistent, the candidate never resurfaces
  }
  m = /^\/transfers\/pair\/(\d+)$/.exec(path)
  if (m && method === 'DELETE') {
    const pairId = Number(m[1])
    const legs = db.transactions.filter((t) => t.transfer_pair_id === pairId)
    if (legs.length === 0) notFound('transfer pair')
    for (const t of legs) t.transfer_pair_id = null
    // unlink AND tombstone: never auto-paired again (manual re-pair allowed)
    if (legs.length === 2) db.transferTombstones.add(db.tombstoneKey(legs[0]!.id, legs[1]!.id))
    return undefined
  }

  /* ---- category rules (v1.2) ---- */
  if (key === 'GET /rules') return [...db.rules].sort((a, b) => a.priority - b.priority)
  if (key === 'POST /rules') {
    const r: CategoryRule = {
      id: db.nextId.rule++,
      pattern: '',
      match: 'contains',
      field: 'payee',
      category: '',
      priority: db.rules.length + 1,
      ...(body as object),
    }
    db.rules.push(r)
    return r
  }
  if (key === 'POST /rules/apply') {
    const sorted = [...db.rules].sort((a, b) => a.priority - b.priority)
    let recategorized = 0
    for (const t of db.transactions) {
      // retroactive over uncategorized + rule/heuristic-sourced; never manual
      if (t.category_source === 'manual' || t.category_source === 'ai') continue
      if (t.transfer_pair_id !== null) continue
      const payee = t.payee.toLowerCase()
      const rule = sorted.find((r) =>
        r.match === 'exact' ? payee === r.pattern.toLowerCase() : payee.includes(r.pattern.toLowerCase()),
      )
      if (rule && (t.category !== rule.category || t.category_source === 'none')) {
        t.category = rule.category
        t.category_source = 'rule'
        recategorized++
      }
    }
    return { recategorized }
  }
  m = /^\/rules\/(\d+)$/.exec(path)
  if (m) {
    const r = db.rules.find((x) => x.id === Number(m![1])) ?? notFound('rule')
    if (method === 'PATCH') return Object.assign(r, body)
    if (method === 'DELETE') {
      db.rules.splice(db.rules.indexOf(r), 1)
      return undefined
    }
  }

  /* ---- categorization suggest (v1.2 — heuristics only, AI stubbed) ---- */
  if (key === 'POST /categorize/suggest') {
    const req = body as unknown as { payees: string[] }
    return suggestCategories(req.payees ?? [])
  }

  /* ---- spending analytics (v1.2) ---- */
  if (key === 'GET /spending/summary')
    return spendingSummary(query?.from ? String(query.from) : undefined, query?.to ? String(query.to) : undefined)
  if (key === 'GET /spending/recurring') return detectRecurring()
  if (key === 'GET /spending/hotspots') return hotspots(Number(query?.months ?? 6))
  if (key === 'GET /spending/forecast') return forecast(Number(query?.months ?? 12))

  /* ---- AI budget & admin (v1.2) ---- */
  if (key === 'GET /settings/ai') return aiSettings()
  if (key === 'PUT /settings/ai') {
    const patch = body as unknown as AiSettingsUpdate
    if ('api_key' in patch) db.aiState.api_key = patch.api_key ?? null
    if (patch.enabled !== undefined) db.aiState.enabled = patch.enabled
    if (patch.monthly_budget_usd !== undefined) {
      if (!(patch.monthly_budget_usd >= 0))
        throw new ApiError(400, 'invalid_budget', 'monthly_budget_usd must be ≥ 0')
      db.aiState.monthly_budget_usd = patch.monthly_budget_usd
    }
    return aiSettings()
  }
  if (key === 'GET /ai/usage') {
    const months = Math.min(24, Math.max(1, Number(query?.months ?? 6)))
    const out: AiUsageMonth[] = []
    const d = new Date()
    d.setDate(1)
    for (let i = 0; i < months; i++) {
      const m = new Date(d)
      m.setMonth(d.getMonth() - i)
      out.push({
        month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
        input_tokens: 0,
        output_tokens: 0,
        est_cost_usd: 0,
        by_purpose: { categorize: { input_tokens: 0, output_tokens: 0, est_cost_usd: 0 } },
      })
    }
    return out
  }

  /* ---- import ---- */
  if (key === 'POST /import/preview') return importPreview(form!)
  if (key === 'POST /import/commit') return importCommit(form!)
  if (key === 'GET /import/presets') return db.importPresets
  m = /^\/import\/presets\/(\d+)$/.exec(path)
  if (m && method === 'DELETE') {
    const p = db.importPresets.find((x) => x.id === Number(m![1])) ?? notFound('preset')
    db.importPresets.splice(db.importPresets.indexOf(p), 1)
    return undefined
  }

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
      const sim = simulate(s.params)
      return { scenario_id: id, name: s.name, ...sim }
    })
    return { results } satisfies CompareResult
  }

  /* ---- simulate ---- */
  if (key === 'POST /simulate') {
    const req = body as unknown as SimulateRequest
    const params = 'scenario_id' in req ? scenarioById(req.scenario_id).params : req.params
    return simulate(params)
  }

  /* ---- dashboard & settings ---- */
  if (key === 'GET /dashboard') return dashboard()
  if (key === 'GET /settings') return db.settings
  if (key === 'PATCH /settings') return Object.assign(db.settings, body)

  /* ---- admin reset (#27) ---- */
  if (key === 'POST /admin/reset') {
    const mode = String(body?.mode ?? '')
    if (mode !== 'demo' && mode !== 'empty')
      throw new ApiError(422, 'validation_error', 'mode must be demo or empty')
    if (String(body?.confirm ?? '') !== 'reset ludovitae')
      throw new ApiError(422, 'confirm_required', 'confirm must be exactly "reset ludovitae"')
    db.resetDb(mode)
    const stamp = todayISO().replace(/-/g, '')
    return { backup: `pre-reset-${stamp}T000000Z.db`, mode }
  }

  throw new ApiError(404, 'not_found', `No mock route for ${key}`)
}

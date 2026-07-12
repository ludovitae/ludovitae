/** Import wizard: drag-drop → column mapping preview → dedupe report.
 * v1.2.2 (T-009): institution presets (auto-matched by header fingerprint),
 * sign-convention confirm step, split debit/credit mapping.
 * #26: create-unseen-accounts — OFX ACCTID auto-match, inline new-account
 * mini-form, multi-account CSV routing (per-group match/create), preset
 * last-account defaults, pending-row (status column) reporting.
 * #30: `?account=<id>` pre-scopes the wizard to one account — the picker is
 * pre-selected and locked (with an unlock affordance); presets still
 * auto-match. The sidebar Import tab is this same page, unscoped. */

import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useAccounts } from '@/api/queries'
import { qk } from '@/api/queries'
import { useQueryClient } from '@tanstack/react-query'
import type {
  Account,
  AccountGroup,
  AccountMap,
  AccountType,
  CsvMapping,
  ImportCommitResult,
  ImportPreview,
  ImportPreviewCsv,
  ImportPreviewOfx,
  NewAccountPayload,
} from '@/api/types'
import { ACCOUNT_TYPES, LIABILITY_TYPES } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { Field, Select, TextInput, Toggle } from '@/components/Field'
import { Skeleton } from '@/components/Skeleton'
import { IconCheck, IconUpload, IconWarning, IconX } from '@/components/icons'
import { formatMoney } from '@/lib/format'
import { PageHeader } from '@/layout/AppShell'

const NEW_ACCOUNT = 'new'

type PickTarget = { kind: 'existing'; id: number } | { kind: 'new' }

type Step =
  | { at: 'pick' }
  | {
      at: 'preview'
      file: File
      kind: 'csv' | 'ofx'
      target: PickTarget
      preview: ImportPreview
      fileText: string
    }
  | { at: 'done'; result: ImportCommitResult; accountName: string }

/** #26: guess a sensible account type from a provider account name. */
function guessAccountType(name: string | null | undefined): AccountType {
  const n = (name ?? '').toLowerCase()
  if (/401|403|ira|roth|retirement|pension/.test(n)) return 'retirement'
  if (/hsa/.test(n)) return 'hsa'
  if (/check|cash management/.test(n)) return 'checking'
  if (/saving/.test(n)) return 'savings'
  if (/card/.test(n)) return 'credit_card'
  return 'brokerage'
}

/** #26: client-side OFX hints for the new-account mini-form (name from ORG,
 * type from the message set / ACCTTYPE). */
function ofxHints(text: string): { org: string | null; type: AccountType | null } {
  const org = /<ORG>([^<\r\n]+)/i.exec(text)?.[1]?.trim() ?? null
  let type: AccountType | null = null
  if (/<CCACCTFROM>/i.test(text) || /<CREDITCARDMSGSRSV1>/i.test(text)) type = 'credit_card'
  else if (/<ACCTTYPE>\s*SAVINGS/i.test(text)) type = 'savings'
  else if (/<ACCTTYPE>\s*CHECKING/i.test(text)) type = 'checking'
  return { org, type }
}

function typeLabel(t: AccountType): string {
  return t.replaceAll('_', ' ')
}

export function ImportPage() {
  const { data: accounts, isPending } = useAccounts()
  const [step, setStep] = useState<Step>({ at: 'pick' })
  const [error, setError] = useState<string | null>(null)
  // #30: pre-scoped by the account detail page's "Import into this account"
  const [searchParams] = useSearchParams()
  const [unlocked, setUnlocked] = useState(false)

  const importable = useMemo(
    () => (accounts ?? []).filter((a) => !LIABILITY_TYPES.includes(a.type) || a.type === 'credit_card'),
    [accounts],
  )

  const scopedParam = Number(searchParams.get('account'))
  const scoped = (!unlocked && importable.find((a) => a.id === scopedParam)) || null

  if (isPending) {
    return (
      <>
        <PageHeader title="Import" />
        <Skeleton className="h-72" />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Import" hint="Bank exports in, tidy transactions out — duplicates skipped" />

      <StepRail current={step.at} />

      {error ? (
        <p role="alert" className="mb-3 rounded-(--radius-s) border border-(--negative) bg-negative/10 px-3 py-2 text-[13px] text-negative">
          {error}
        </p>
      ) : null}

      {step.at === 'pick' ? (
        <PickStep
          accounts={importable}
          scoped={scoped}
          onUnlock={() => setUnlocked(true)}
          onError={setError}
          onPreview={(next) => {
            setError(null)
            setStep(next)
          }}
        />
      ) : null}

      {step.at === 'preview' ? (
        <PreviewStep
          step={step}
          accounts={importable}
          scoped={scoped}
          onUnlock={() => setUnlocked(true)}
          onBack={() => setStep({ at: 'pick' })}
          onError={setError}
          onDone={(result, accountName) => {
            setError(null)
            setStep({ at: 'done', result, accountName })
          }}
        />
      ) : null}

      {step.at === 'done' ? (
        <DoneStep result={step.result} accountName={step.accountName} onRestart={() => setStep({ at: 'pick' })} />
      ) : null}
    </>
  )
}

function StepRail({ current }: { current: Step['at'] }) {
  const steps = [
    { id: 'pick', label: '1 · Choose file' },
    { id: 'preview', label: '2 · Map & review' },
    { id: 'done', label: '3 · Result' },
  ]
  const idx = steps.findIndex((s) => s.id === current)
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              i === idx ? 'bg-accent-soft text-ink' : i < idx ? 'text-positive' : 'text-ink-3'
            }`}
          >
            {i < idx ? <IconCheck width={12} height={12} className="mr-1 inline" /> : null}
            {s.label}
          </span>
          {i < steps.length - 1 ? <span className="h-px w-6 bg-(--border-strong)" /> : null}
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------ step 1 ----------------------------------- */

function PickStep({
  accounts,
  scoped,
  onUnlock,
  onPreview,
  onError,
}: {
  accounts: Account[]
  /** #30: pre-scoped target; the picker locks onto it until unlocked */
  scoped: Account | null
  onUnlock: () => void
  onPreview: (step: Extract<Step, { at: 'preview' }>) => void
  onError: (msg: string | null) => void
}) {
  // #26: with no accounts yet, the wizard starts on "create new" — imports
  // work from a completely empty database. #30: a scope pins the choice.
  const [choice, setChoice] = useState<string>(
    scoped ? String(scoped.id) : accounts[0] ? String(accounts[0].id) : NEW_ACCOUNT,
  )
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      const kind: 'csv' | 'ofx' = /\.(ofx|qfx)$/i.test(file.name) ? 'ofx' : 'csv'
      const target: PickTarget =
        choice === NEW_ACCOUNT ? { kind: 'new' } : { kind: 'existing', id: Number(choice) }
      setBusy(true)
      try {
        const preview = await api.import.preview(
          file, kind, target.kind === 'existing' ? target.id : null,
        )
        const fileText = kind === 'ofx' ? await file.text() : ''
        onPreview({ at: 'preview', file, kind, target, preview, fileText })
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not read that file.')
      } finally {
        setBusy(false)
      }
    },
    [choice, onPreview, onError],
  )

  function useSample() {
    const csv = [
      'Date,Description,Amount,Category',
      '2026-06-02,New Seasons Market,-84.12,groceries',
      '2026-06-03,ACME Corp Payroll,4900.00,salary',
      '2026-06-05,Rocket Mortgage,-2350.00,housing',
      '2026-06-08,Chevron,-51.40,auto',
      '2026-06-09,Ristretto Roasters,-13.75,dining',
      '2026-06-12,PGE,-131.22,utilities',
      '2026-06-15,ACME Corp Payroll,4900.00,salary',
      '2026-06-18,REI,-129.95,shopping',
      '2026-06-21,Powell’s Books,-42.50,shopping',
      '2026-06-27,Nostrana,-116.80,dining',
    ].join('\n')
    void handleFile(new File([csv], 'sample-checking.csv', { type: 'text/csv' }))
  }

  return (
    <Card>
      <div className="flex flex-col gap-4 p-5">
        <Field
          label="Into account"
          hint={choice === NEW_ACCOUNT ? 'You’ll name the new account after we read the file' : undefined}
        >
          {(id) => (
            <div className="flex items-center gap-2">
              <Select
                id={id}
                value={choice}
                disabled={scoped !== null}
                onChange={(e) => setChoice(e.target.value)}
                className="flex-1"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>＋ Create new account…</option>
              </Select>
              {scoped ? (
                <Button variant="ghost" size="sm" onClick={onUnlock}>
                  Import elsewhere
                </Button>
              ) : null}
            </div>
          )}
        </Field>
        {scoped ? (
          <p className="-mt-2 text-xs text-ink-3">
            Scoped to <span className="font-medium text-ink-2">{scoped.name}</span> from its account
            page — every file lands there unless you unlock the picker.
          </p>
        ) : null}

        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) void handleFile(file)
          }}
          className={`grid cursor-pointer place-items-center rounded-(--radius-m) border-2 border-dashed px-6 py-14 text-center transition-colors duration-150 ${
            dragging ? 'border-(--accent) bg-accent-soft' : 'border-edge-strong hover:border-(--accent)'
          }`}
        >
          <input
            type="file"
            accept=".csv,.ofx,.qfx,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          <span className="mb-2 text-ink-3">
            <IconUpload width={28} height={28} />
          </span>
          <p className="text-sm font-medium text-ink">
            {busy ? 'Reading…' : dragging ? 'Drop it' : 'Drop a CSV or OFX export here'}
          </p>
          <p className="mt-1 text-xs text-ink-3">or click to browse · files are parsed, never stored</p>
        </label>

        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-3">Just exploring?</p>
          <Button variant="ghost" size="sm" onClick={useSample} disabled={busy}>
            Use a sample file
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------ step 2 ----------------------------------- */

interface NewAccountDraft {
  name: string
  type: AccountType
  institution: string
}

type GroupChoice = { kind: 'existing'; id: number } | { kind: 'new'; name: string; type: AccountType }

function draftToPayload(d: NewAccountDraft): NewAccountPayload {
  return { name: d.name.trim(), type: d.type, institution: d.institution.trim() || null }
}

function PreviewStep({
  step,
  accounts,
  scoped,
  onUnlock,
  onBack,
  onDone,
  onError,
}: {
  step: Extract<Step, { at: 'preview' }>
  accounts: Account[]
  /** #30: pre-scoped target; wins over OFX match and preset defaults */
  scoped: Account | null
  onUnlock: () => void
  onBack: () => void
  onDone: (result: ImportCommitResult, accountName: string) => void
  onError: (msg: string | null) => void
}) {
  const qc = useQueryClient()
  const isCsv = step.kind === 'csv'
  const [preview, setPreview] = useState(step.preview)
  const csv = isCsv ? (preview as ImportPreviewCsv) : null
  const ofx = !isCsv ? (preview as ImportPreviewOfx) : null
  const preset = csv?.matched_preset ?? null
  const [usingPreset, setUsingPreset] = useState(preset !== null)
  const [mapping, setMapping] = useState<Partial<CsvMapping>>(
    preset?.mapping ?? csv?.suggested_mapping ?? {},
  )
  const [splitColumns, setSplitColumns] = useState(
    !!((preset?.mapping ?? csv?.suggested_mapping)?.debit && (preset?.mapping ?? csv?.suggested_mapping)?.credit),
  )
  // sign confirm step: preset wins, then the hint pre-checks the box
  const [flipSigns, setFlipSigns] = useState(
    preset ? preset.flip_signs : (csv?.sign_hint?.looks_flipped ?? false),
  )
  const [presetName, setPresetName] = useState('')
  const [updateBalance, setUpdateBalance] = useState(false)
  const [busy, setBusy] = useState(false)

  const multiGroups = csv?.account_groups ?? null
  const multi = !!(multiGroups && mapping.account_id_column)

  // --- single-target selection: #30 scope > OFX match > preset default >
  // step-1 pick (#26)
  const hints = !isCsv ? ofxHints(step.fileText) : { org: null, type: null }
  const matchedId = ofx?.account_match.account_id ?? null
  const initialTarget = (): string => {
    if (scoped) return String(scoped.id)
    if (matchedId !== null) return String(matchedId)
    if (isCsv && preset?.last_account_id != null) return String(preset.last_account_id)
    if (step.target.kind === 'existing') return String(step.target.id)
    return NEW_ACCOUNT
  }
  const [targetChoice, setTargetChoice] = useState<string>(initialTarget)
  const [draft, setDraft] = useState<NewAccountDraft>(() => ({
    name: hints.org ?? '',
    type: hints.type ?? guessAccountType(hints.org),
    institution: hints.org ?? '',
  }))

  // --- multi-account choices (#26): matched groups keep their account,
  // unseen ones default to "create new" with a guessed type
  const [groupChoices, setGroupChoices] = useState<Record<string, GroupChoice>>(() => {
    const out: Record<string, GroupChoice> = {}
    for (const g of multiGroups ?? []) {
      out[g.key] =
        g.account_id !== null
          ? { kind: 'existing', id: g.account_id }
          : { kind: 'new', name: g.name ?? g.number_masked, type: guessAccountType(g.name) }
    }
    return out
  })

  const targetAccountName =
    targetChoice === NEW_ACCOUNT
      ? draft.name.trim() || 'new account'
      : (accounts.find((a) => a.id === Number(targetChoice))?.name ?? 'account')

  const mappingComplete =
    !isCsv ||
    (!!mapping.date && (splitColumns ? !!mapping.debit && !!mapping.credit : !!mapping.amount))

  const newAccountReady =
    multi ||
    targetChoice !== NEW_ACCOUNT ||
    draft.name.trim().length > 0

  const groupsReady =
    !multi ||
    (multiGroups ?? []).every((g) => {
      const c = groupChoices[g.key]
      return c && (c.kind === 'existing' || c.name.trim().length > 0)
    })

  function detachPreset() {
    setUsingPreset(false)
    const suggested = csv?.suggested_mapping ?? {}
    setMapping(suggested)
    setSplitColumns(!!(suggested.debit && suggested.credit))
    setFlipSigns(csv?.sign_hint?.looks_flipped ?? false)
    void remap(suggested)
  }

  function toggleSplit(on: boolean) {
    setSplitColumns(on)
    setMapping(
      on
        ? { ...mapping, amount: undefined }
        : { ...mapping, debit: undefined, credit: undefined },
    )
  }

  /** #26: account/status column changes re-preview so groups/pending refresh. */
  async function remap(next: Partial<CsvMapping>) {
    if (!isCsv) return
    try {
      const accountId = step.target.kind === 'existing' ? step.target.id : null
      const fresh = await api.import.preview(step.file, step.kind, accountId, { mapping: next })
      setPreview(fresh)
    } catch {
      /* preview refresh is best-effort; commit still validates */
    }
  }

  function setMappingField(field: keyof CsvMapping, value: string | undefined) {
    const next = { ...mapping, [field]: value }
    setMapping(next)
    if (field === 'account_column' || field === 'account_id_column' || field === 'status_column') {
      void remap(next)
    }
  }

  async function commit() {
    setBusy(true)
    try {
      let target:
        | { accountId: number }
        | { newAccount: NewAccountPayload }
        | { accountMap: AccountMap }
      if (multi) {
        const accountMap: AccountMap = {}
        for (const g of multiGroups ?? []) {
          const c = groupChoices[g.key]!
          accountMap[g.key] =
            c.kind === 'existing'
              ? { account_id: c.id }
              : { new_account: { name: c.name.trim(), type: c.type } }
        }
        target = { accountMap }
      } else if (targetChoice === NEW_ACCOUNT) {
        target = { newAccount: draftToPayload(draft) }
      } else {
        target = { accountId: Number(targetChoice) }
      }
      const result = await api.import.commit(
        step.file,
        step.kind,
        target,
        isCsv ? (mapping as CsvMapping) : null,
        updateBalance,
        { flipSigns: isCsv && flipSigns, savePreset: isCsv ? presetName : undefined },
      )
      void qc.invalidateQueries({ queryKey: qk.transactions(undefined) })
      void qc.invalidateQueries({ queryKey: qk.accounts })
      void qc.invalidateQueries({ queryKey: qk.dashboard })
      void qc.invalidateQueries({ queryKey: qk.importPresets })
      onDone(result, multi ? 'multiple accounts' : targetAccountName)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  const hasAccountColumns = !!(mapping.account_column || mapping.account_id_column)
  const hasStatusColumn = !!mapping.status_column || (csv?.pending_rows ?? null) !== null
  const mappedFields: (keyof CsvMapping)[] = [
    'date',
    ...(splitColumns ? (['debit', 'credit'] as const) : (['amount'] as const)),
    'payee',
    'category',
    ...(hasAccountColumns ? (['account_column', 'account_id_column'] as const) : []),
    ...(hasStatusColumn ? (['status_column'] as const) : []),
  ]
  const fieldLabels: Record<string, string> = {
    date: 'Date',
    amount: 'Amount',
    debit: 'Debit (money out)',
    credit: 'Credit (money in)',
    payee: 'Payee / description',
    category: 'Category',
    account_column: 'Account name',
    account_id_column: 'Account number',
    status_column: 'Status',
  }
  const required = new Set(splitColumns ? ['date', 'debit', 'credit'] : ['date', 'amount'])

  return (
    <div className="flex flex-col gap-4">
      {csv && preset && usingPreset ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-s) border border-(--accent) bg-accent-soft px-3 py-2.5">
          <p className="text-[13px] text-ink">
            <IconCheck width={14} height={14} className="mr-1.5 inline text-accent" />
            Using your <span className="font-semibold">{preset.name}</span> preset — columns
            {preset.flip_signs ? ' and sign flip' : ''} filled in from last time.
          </p>
          <Button variant="ghost" size="sm" onClick={detachPreset}>
            Don’t use the preset
          </Button>
        </div>
      ) : null}

      {ofx && ofx.account_match.acctid_masked ? (
        matchedId !== null ? (
          <div className="rounded-(--radius-s) border border-(--accent) bg-accent-soft px-3 py-2.5 text-[13px] text-ink">
            <IconCheck width={14} height={14} className="mr-1.5 inline text-accent" />
            Matched {ofx.account_match.acctid_masked} →{' '}
            <span className="font-semibold">
              {accounts.find((a) => a.id === matchedId)?.name ?? 'account'}
            </span>
          </div>
        ) : (
          <div className="rounded-(--radius-s) border border-edge bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
            Account {ofx.account_match.acctid_masked} isn’t linked yet — pick where these
            transactions land below, or create a new account. We’ll remember it next time.
          </div>
        )
      ) : null}

      {csv ? (
        <Card>
          <CardHeader
            title="Map the columns"
            hint="We guessed from the headers — correct anything that looks off"
            action={
              <label className="flex items-center gap-2 text-[12px] text-ink-2">
                <Toggle checked={splitColumns} onChange={toggleSplit} label="Separate debit and credit columns" />
                Separate debit / credit columns
              </label>
            }
          />
          <div className="grid grid-cols-2 gap-3 px-5 pt-2 pb-4 md:grid-cols-4">
            {mappedFields.map((field) => (
              <Field key={field} label={fieldLabels[field]!}>
                {(id) => (
                  <Select
                    id={id}
                    value={mapping[field] ?? ''}
                    onChange={(e) => setMappingField(field, e.target.value || undefined)}
                  >
                    <option value="">{required.has(field) ? 'Choose…' : '— skip —'}</option>
                    {csv.columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
          <div className="overflow-x-auto border-t border-edge">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  {csv.columns.map((c) => (
                    <th key={c} className="px-4 py-2 font-medium whitespace-nowrap">
                      {c}
                      {mappedFields.filter((f) => mapping[f] === c).map((f) => (
                        <MapTag key={f} label={f.replace(/_column$/, '')} />
                      ))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csv.sample_rows.map((row, i) => (
                  <tr key={i} className="border-t border-edge">
                    {csv.columns.map((c) => (
                      <td key={c} className="num px-4 py-1.5 whitespace-nowrap text-ink-2">
                        {row[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader title="OFX file recognized" />
          <div className="flex flex-wrap gap-x-10 gap-y-3 px-5 pt-1 pb-5">
            <OfxStat label="Accounts found" value={ofx!.accounts_found.length ? ofx!.accounts_found.map((a) => `···${a.slice(-4)}`).join(', ') : '—'} />
            <OfxStat label="Transactions" value={String(ofx!.transaction_count)} />
            <OfxStat label="Statement balance" value={formatMoney(ofx!.balance)} />
          </div>
        </Card>
      )}

      {csv && (csv.pending_rows ?? 0) > 0 ? (
        <p className="rounded-(--radius-s) border border-edge bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
          {csv.pending_rows} pending transaction{csv.pending_rows === 1 ? '' : 's'} will be
          skipped — they’ll import once they post.
        </p>
      ) : null}

      {csv && csv.sign_hint && !splitColumns ? (
        <div className="flex gap-2.5 rounded-(--radius-s) border border-(--warning) bg-warning/10 px-3 py-2.5">
          <span className="mt-0.5 shrink-0 text-warning">
            <IconWarning width={15} height={15} />
          </span>
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] leading-relaxed text-ink-2">{csv.sign_hint.reason}</p>
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <input
                type="checkbox"
                checked={flipSigns}
                onChange={(e) => setFlipSigns(e.target.checked)}
                className="size-4 accent-(--accent)"
              />
              Flip signs on import
            </label>
          </div>
        </div>
      ) : null}

      {multi ? (
        <Card>
          <CardHeader
            title="Accounts in this file"
            hint="Each account number maps to one of your accounts — unseen ones become new accounts"
          />
          {scoped ? (
            <p className="px-5 pb-2 text-[12px] text-ink-2">
              This file carries several account numbers, so rows route by the mapping below — the{' '}
              <span className="font-medium">{scoped.name}</span> scope doesn’t apply here.
            </p>
          ) : null}
          <ul className="flex flex-col divide-y divide-(--border) px-5 pb-4">
            {(multiGroups ?? []).map((g) => (
              <GroupRow
                key={g.key}
                group={g}
                accounts={accounts}
                choice={groupChoices[g.key]!}
                onChange={(c) => setGroupChoices({ ...groupChoices, [g.key]: c })}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-col gap-3 px-5 py-4">
          {!multi ? (
            <div className="flex flex-wrap items-start gap-4">
              <Field
                label="Into account"
                hint={scoped ? `Scoped to ${scoped.name} from its account page` : undefined}
              >
                {(id) => (
                  <div className="flex items-center gap-2">
                    <Select
                      id={id}
                      value={targetChoice}
                      disabled={scoped !== null}
                      onChange={(e) => setTargetChoice(e.target.value)}
                      className="w-56"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                      <option value={NEW_ACCOUNT}>＋ Create new account…</option>
                    </Select>
                    {scoped ? (
                      <Button variant="ghost" size="sm" onClick={onUnlock}>
                        Import elsewhere
                      </Button>
                    ) : null}
                  </div>
                )}
              </Field>
              {targetChoice === NEW_ACCOUNT ? (
                <div className="flex flex-wrap items-start gap-3 rounded-(--radius-s) border border-edge bg-surface-2 p-3">
                  <Field label="New account name">
                    {(id) => (
                      <TextInput
                        id={id}
                        value={draft.name}
                        placeholder="e.g. Vanguard Brokerage"
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        className="w-52"
                      />
                    )}
                  </Field>
                  <Field label="Type">
                    {(id) => (
                      <Select
                        id={id}
                        value={draft.type}
                        onChange={(e) => setDraft({ ...draft, type: e.target.value as AccountType })}
                      >
                        {ACCOUNT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {typeLabel(t)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Institution (optional)">
                    {(id) => (
                      <TextInput
                        id={id}
                        value={draft.institution}
                        onChange={(e) => setDraft({ ...draft, institution: e.target.value })}
                        className="w-44"
                      />
                    )}
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            {csv ? (
              <Field
                label="Save this mapping as a preset"
                hint="Next time this institution's file is recognized automatically"
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={presetName}
                    placeholder={usingPreset && preset ? `${preset.name} (already saved)` : 'e.g. Chase card'}
                    onChange={(e) => setPresetName(e.target.value)}
                    className="w-56"
                  />
                )}
              </Field>
            ) : (
              <span />
            )}
            <label className="flex items-center gap-2.5 pb-1 text-[13px] text-ink-2">
              <Toggle checked={updateBalance} onChange={setUpdateBalance} label="Update account balance from import" />
              Also update the account balance from this file
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-edge pt-3">
            <Button variant="ghost" onClick={onBack}>
              <IconX width={14} height={14} /> Start over
            </Button>
            <Button
              variant="primary"
              onClick={() => void commit()}
              disabled={!mappingComplete || !newAccountReady || !groupsReady || busy}
            >
              {busy ? 'Importing…' : 'Import transactions'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

/** #26 multi-account row: matched account or create-new mini-form. */
function GroupRow({
  group,
  accounts,
  choice,
  onChange,
}: {
  group: AccountGroup
  accounts: Account[]
  choice: GroupChoice
  onChange: (c: GroupChoice) => void
}) {
  const value = choice.kind === 'existing' ? String(choice.id) : NEW_ACCOUNT
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-44">
        <p className="text-[13px] font-medium text-ink">{group.name ?? group.number_masked}</p>
        <p className="num text-[11px] text-ink-3">
          {group.number_masked} · {group.rows} row{group.rows === 1 ? '' : 's'}
          {group.account_id !== null ? (
            <span className="ml-1.5 text-positive">matched</span>
          ) : null}
        </p>
      </div>
      <Select
        aria-label={`Account for ${group.name ?? group.number_masked}`}
        value={value}
        onChange={(e) =>
          onChange(
            e.target.value === NEW_ACCOUNT
              ? { kind: 'new', name: group.name ?? group.number_masked, type: guessAccountType(group.name) }
              : { kind: 'existing', id: Number(e.target.value) },
          )
        }
        className="w-52"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        <option value={NEW_ACCOUNT}>＋ Create new account…</option>
      </Select>
      {choice.kind === 'new' ? (
        <>
          <TextInput
            aria-label={`New account name for ${group.number_masked}`}
            value={choice.name}
            onChange={(e) => onChange({ ...choice, name: e.target.value })}
            className="w-48"
          />
          <Select
            aria-label={`New account type for ${group.number_masked}`}
            value={choice.type}
            onChange={(e) => onChange({ ...choice, type: e.target.value as AccountType })}
            className="w-36"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </Select>
        </>
      ) : null}
    </li>
  )
}

function MapTag({ label }: { label: string }) {
  return (
    <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
      {label}
    </span>
  )
}

function OfxStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="num mt-0.5 text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}

/* ------------------------------ step 3 ----------------------------------- */

function DoneStep({
  result,
  accountName,
  onRestart,
}: {
  result: ImportCommitResult
  accountName: string
  onRestart: () => void
}) {
  const created = result.account
  const target = created ? created.name : accountName
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-positive">
          <IconCheck width={24} height={24} />
        </span>
        <div>
          <p className="text-base font-semibold text-ink">
            {result.imported} transaction{result.imported === 1 ? '' : 's'} imported into {target}
          </p>
          {created ? (
            <p className="mt-1 text-[13px] text-ink-2">
              New account <span className="font-medium">{created.name}</span> created and linked —
              future files for it match automatically.
            </p>
          ) : null}
          <p className="mt-1 text-[13px] text-ink-3">
            {result.skipped_duplicates > 0
              ? `${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? '' : 's'} recognized and skipped — import the same file twice and nothing doubles.`
              : 'No duplicates found.'}
            {result.skipped_pending > 0
              ? ` ${result.skipped_pending} pending transaction${result.skipped_pending === 1 ? '' : 's'} skipped until they post.`
              : ''}
          </p>
        </div>
        {result.accounts ? (
          <ul className="w-full max-w-sm divide-y divide-(--border) rounded-(--radius-s) border border-edge text-left">
            {result.accounts.map((a) => (
              <li key={a.account_id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <span className="font-medium text-ink">
                  {a.name}
                  {a.created ? (
                    <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      new
                    </span>
                  ) : null}
                </span>
                <span className="num text-ink-2">
                  {a.imported} imported
                  {a.skipped_duplicates > 0 ? ` · ${a.skipped_duplicates} dupes` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Button variant="primary" onClick={onRestart}>
            Import another file
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Import wizard: drag-drop → column mapping preview → dedupe report.
 * v1.2.2 (T-009): institution presets (auto-matched by header fingerprint),
 * sign-convention confirm step, split debit/credit mapping. */

import { useCallback, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { useAccounts } from '@/api/queries'
import { qk } from '@/api/queries'
import { useQueryClient } from '@tanstack/react-query'
import type { CsvMapping, ImportCommitResult, ImportPreview, ImportPreviewCsv } from '@/api/types'
import { LIABILITY_TYPES } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Field, Select, TextInput, Toggle } from '@/components/Field'
import { Skeleton } from '@/components/Skeleton'
import { IconCheck, IconUpload, IconWarning, IconX } from '@/components/icons'
import { formatMoney } from '@/lib/format'
import { PageHeader } from '@/layout/AppShell'

type Step =
  | { at: 'pick' }
  | { at: 'preview'; file: File; kind: 'csv' | 'ofx'; accountId: number; preview: ImportPreview }
  | { at: 'done'; result: ImportCommitResult; accountId: number }

export function ImportPage() {
  const { data: accounts, isPending } = useAccounts()
  const [step, setStep] = useState<Step>({ at: 'pick' })
  const [error, setError] = useState<string | null>(null)

  const importable = useMemo(
    () => (accounts ?? []).filter((a) => !LIABILITY_TYPES.includes(a.type) || a.type === 'credit_card'),
    [accounts],
  )

  if (isPending) {
    return (
      <>
        <PageHeader title="Import" />
        <Skeleton className="h-72" />
      </>
    )
  }

  if ((accounts ?? []).length === 0) {
    return (
      <>
        <PageHeader title="Import" />
        <Card>
          <EmptyState
            illustration="file"
            title="Add an account first"
            hint="Transactions need somewhere to land. Create the account, then bring in its CSV or OFX export."
          />
        </Card>
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
          accounts={importable.map((a) => ({ id: a.id, name: a.name }))}
          onError={setError}
          onPreview={(file, kind, accountId, preview) => {
            setError(null)
            setStep({ at: 'preview', file, kind, accountId, preview })
          }}
        />
      ) : null}

      {step.at === 'preview' ? (
        <PreviewStep
          step={step}
          onBack={() => setStep({ at: 'pick' })}
          onError={setError}
          onDone={(result) => {
            setError(null)
            setStep({ at: 'done', result, accountId: step.accountId })
          }}
        />
      ) : null}

      {step.at === 'done' ? (
        <DoneStep
          result={step.result}
          accountName={accounts?.find((a) => a.id === step.accountId)?.name ?? 'account'}
          onRestart={() => setStep({ at: 'pick' })}
        />
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
  onPreview,
  onError,
}: {
  accounts: { id: number; name: string }[]
  onPreview: (file: File, kind: 'csv' | 'ofx', accountId: number, preview: ImportPreview) => void
  onError: (msg: string | null) => void
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      const kind: 'csv' | 'ofx' = /\.(ofx|qfx)$/i.test(file.name) ? 'ofx' : 'csv'
      setBusy(true)
      try {
        const preview = await api.import.preview(file, kind, accountId)
        onPreview(file, kind, accountId, preview)
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not read that file.')
      } finally {
        setBusy(false)
      }
    },
    [accountId, onPreview, onError],
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
        <Field label="Into account">
          {(id) => (
            <Select id={id} value={String(accountId)} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

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

function PreviewStep({
  step,
  onBack,
  onDone,
  onError,
}: {
  step: Extract<Step, { at: 'preview' }>
  onBack: () => void
  onDone: (result: ImportCommitResult) => void
  onError: (msg: string | null) => void
}) {
  const qc = useQueryClient()
  const isCsv = step.kind === 'csv'
  const csv = isCsv ? (step.preview as ImportPreviewCsv) : null
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

  const mappingComplete =
    !isCsv ||
    (!!mapping.date && (splitColumns ? !!mapping.debit && !!mapping.credit : !!mapping.amount))

  function detachPreset() {
    setUsingPreset(false)
    const suggested = csv?.suggested_mapping ?? {}
    setMapping(suggested)
    setSplitColumns(!!(suggested.debit && suggested.credit))
    setFlipSigns(csv?.sign_hint?.looks_flipped ?? false)
  }

  function toggleSplit(on: boolean) {
    setSplitColumns(on)
    setMapping(
      on
        ? { ...mapping, amount: undefined }
        : { ...mapping, debit: undefined, credit: undefined },
    )
  }

  async function commit() {
    setBusy(true)
    try {
      const result = await api.import.commit(
        step.file,
        step.kind,
        step.accountId,
        isCsv ? (mapping as CsvMapping) : null,
        updateBalance,
        { flipSigns: isCsv && flipSigns, savePreset: isCsv ? presetName : undefined },
      )
      void qc.invalidateQueries({ queryKey: qk.transactions(undefined) })
      void qc.invalidateQueries({ queryKey: qk.accounts })
      void qc.invalidateQueries({ queryKey: qk.dashboard })
      void qc.invalidateQueries({ queryKey: qk.importPresets })
      onDone(result)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  const mappedFields: readonly (keyof CsvMapping)[] = splitColumns
    ? (['date', 'debit', 'credit', 'payee', 'category'] as const)
    : (['date', 'amount', 'payee', 'category'] as const)
  const fieldLabels: Record<string, string> = {
    date: 'Date',
    amount: 'Amount',
    debit: 'Debit (money out)',
    credit: 'Credit (money in)',
    payee: 'Payee / description',
    category: 'Category',
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
                    onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}
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
                        <MapTag key={f} label={f} />
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
            <OfxStat label="Accounts found" value={(step.preview as { accounts_found: string[] }).accounts_found.join(', ')} />
            <OfxStat label="Transactions" value={String((step.preview as { transaction_count: number }).transaction_count)} />
            <OfxStat label="Statement balance" value={formatMoney((step.preview as { balance: number }).balance)} />
          </div>
        </Card>
      )}

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

      <Card>
        <div className="flex flex-col gap-3 px-5 py-4">
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
            <Button variant="primary" onClick={() => void commit()} disabled={!mappingComplete || busy}>
              {busy ? 'Importing…' : 'Import transactions'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
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
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-positive">
          <IconCheck width={24} height={24} />
        </span>
        <div>
          <p className="text-base font-semibold text-ink">
            {result.imported} transaction{result.imported === 1 ? '' : 's'} imported into {accountName}
          </p>
          <p className="mt-1 text-[13px] text-ink-3">
            {result.skipped_duplicates > 0
              ? `${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? '' : 's'} recognized and skipped — import the same file twice and nothing doubles.`
              : 'No duplicates found.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={onRestart}>
            Import another file
          </Button>
        </div>
      </div>
    </Card>
  )
}

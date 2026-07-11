/** Spending page (v1.1) — planned categories (essential vs discretionary,
 * inline amount edit), monthly savings target, observed-vs-planned panel from
 * /spending/observed with per-row "use observed", and the recurring-flows
 * list (owner picker per row) with the double-count warning the contract
 * requires when expense-kind flows coexist with categories. */

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  useFlows,
  useHousehold,
  useObservedSpending,
  usePatchFlow,
  useSpending,
  useUpdateSpending,
} from '@/api/queries'
import type { Flow, SpendingCategory, SpendingKind, SpendingProfile } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Field, Select, TextInput } from '@/components/Field'
import { Modal } from '@/components/Overlay'
import { Skeleton } from '@/components/Skeleton'
import { IconPlus, IconTrash, IconWarning } from '@/components/icons'
import { formatMoney } from '@/lib/format'
import { mergeObservedPlanned } from '@/lib/spendingMerge'
import { PageHeader } from '@/layout/AppShell'
import { Link } from 'react-router-dom'

const KIND_LABELS: Record<SpendingKind, string> = {
  essential: 'Essential',
  discretionary: 'Discretionary',
}

const WINDOWS = [3, 6, 12, 24] as const

export function SpendingPage() {
  const { data: spending, isPending } = useSpending()
  const { data: flows } = useFlows()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader
        title="Spending"
        hint="What life costs — planned categories, and what the transactions actually say"
        action={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <IconPlus width={16} height={16} /> Add category
          </Button>
        }
      />

      {isPending || !spending ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <PlanCard spending={spending} flows={flows ?? []} onAdd={() => setAdding(true)} />
            <ObservedCard spending={spending} />
          </div>
          <FlowsCard flows={flows ?? []} />
        </div>
      )}

      {adding && spending ? <AddCategoryModal spending={spending} onClose={() => setAdding(false)} /> : null}
    </>
  )
}

/* ------------------------------ plan card -------------------------------- */

function PlanCard({
  spending,
  flows,
  onAdd,
}: {
  spending: SpendingProfile
  flows: Flow[]
  onAdd: () => void
}) {
  const update = useUpdateSpending()

  const plannedTotal = spending.categories.reduce((s, c) => s + c.monthly_amount, 0)
  const expenseFlows = flows.filter((f) => f.kind === 'expense')
  const expenseFlowTotal = expenseFlows.reduce((s, f) => s + f.amount_monthly, 0)

  function putCategories(categories: SpendingCategory[], target = spending.monthly_savings_target) {
    update.mutate([{ categories, monthly_savings_target: target }])
  }

  function patchCategory(id: number, amount: number) {
    putCategories(
      spending.categories.map((c) => (c.id === id ? { ...c, monthly_amount: amount } : c)),
    )
  }

  function removeCategory(id: number) {
    putCategories(spending.categories.filter((c) => c.id !== id))
  }

  return (
    <Card>
      <CardHeader
        title="Planned spending"
        hint="Monthly categories — they stop when the last earner retires"
      />
      {spending.categories.length === 0 ? (
        <EmptyState
          illustration="coins"
          title="No categories yet"
          hint="Sketch your monthly spending — groceries, utilities, the fun stuff. Or pull the numbers straight from your imported transactions on the right."
          action={
            <Button variant="primary" onClick={onAdd}>
              <IconPlus width={16} height={16} /> Add category
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col px-5 pt-1 pb-4">
          {(['essential', 'discretionary'] as const).map((kind) => {
            const cats = spending.categories.filter((c) => c.kind === kind)
            if (cats.length === 0) return null
            const subtotal = cats.reduce((s, c) => s + c.monthly_amount, 0)
            return (
              <section key={kind} aria-label={KIND_LABELS[kind]} className="py-2">
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                    {KIND_LABELS[kind]}
                  </h3>
                  <p className="num text-xs text-ink-3">{formatMoney(subtotal)}/mo</p>
                </div>
                <ul className="divide-y divide-(--border)">
                  {cats.map((c) => (
                    <li key={c.id} className="group flex items-center gap-2 py-1.5">
                      <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{c.name}</p>
                      {c.annual_growth_pct != null ? (
                        <span className="num shrink-0 text-[11px] text-ink-3">+{c.annual_growth_pct}%/yr</span>
                      ) : null}
                      <InlineAmount
                        value={c.monthly_amount}
                        ariaLabel={`Monthly amount for ${c.name}`}
                        onCommit={(v) => patchCategory(c.id, v)}
                      />
                      <button
                        type="button"
                        onClick={() => removeCategory(c.id)}
                        aria-label={`Delete category ${c.name}`}
                        className="rounded p-1 text-ink-3 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-negative"
                      >
                        <IconTrash width={14} height={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          <div className="mt-1 flex items-center justify-between border-t border-edge pt-3">
            <p className="text-[13px] font-medium text-ink">Planned total</p>
            <p className="num text-sm font-semibold text-ink">{formatMoney(plannedTotal)}/mo</p>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-(--radius-s) bg-surface-2 px-3 py-2">
            <div>
              <p className="text-[13px] font-medium text-ink">Monthly savings target</p>
              <p className="text-[11px] text-ink-3">Informational — actual saving comes from contribution flows</p>
            </div>
            <InlineAmount
              value={spending.monthly_savings_target}
              ariaLabel="Monthly savings target"
              onCommit={(v) => putCategories(spending.categories, v)}
            />
          </div>

          {expenseFlows.length > 0 ? (
            <div className="mt-3 flex gap-2.5 rounded-(--radius-s) border border-(--warning) bg-warning/10 px-3 py-2.5">
              <span className="mt-0.5 shrink-0 text-warning">
                <IconWarning width={15} height={15} />
              </span>
              <p className="text-[12px] leading-relaxed text-ink-2">
                <span className="font-medium text-ink">
                  Both counted in the simulation:{' '}
                  <span className="num">{formatMoney(plannedTotal)}</span>/mo categories +{' '}
                  <span className="num">{formatMoney(expenseFlowTotal)}</span>/mo across {expenseFlows.length}{' '}
                  expense {expenseFlows.length === 1 ? 'flow' : 'flows'} ={' '}
                  <span className="num">{formatMoney(plannedTotal + expenseFlowTotal)}</span>/mo.
                </span>{' '}
                Keep everyday costs in categories; keep flows for fixed payments like the mortgage — and don’t
                enter the same cost twice.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}

/** Click-to-edit monthly amount, Enter saves, Escape cancels. */
function InlineAmount({
  value,
  ariaLabel,
  onCommit,
}: {
  value: number
  ariaLabel: string
  onCommit: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function commit() {
    const num = Number(draft.replace(/[$,\s]/g, ''))
    setEditing(false)
    if (Number.isFinite(num) && num >= 0 && num !== value) onCommit(num)
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        aria-label={ariaLabel}
        className="num h-7 w-24 rounded-(--radius-s) border border-(--accent) bg-surface-3 px-2 text-right text-[13px] text-ink"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(value))
        setEditing(true)
      }}
      aria-label={ariaLabel}
      title="Click to edit"
      className="num shrink-0 rounded-(--radius-s) px-2 py-0.5 text-right text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-surface-2"
    >
      {formatMoney(value)}
      <span className="text-ink-3">/mo</span>
    </button>
  )
}

/* ---------------------------- observed card ------------------------------ */

function ObservedCard({ spending }: { spending: SpendingProfile }) {
  const [months, setMonths] = useState<number>(12)
  const observed = useObservedSpending(months)
  const update = useUpdateSpending()

  const rows = useMemo(
    () => mergeObservedPlanned(spending.categories, observed.data?.by_category ?? []),
    [spending.categories, observed.data],
  )
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned ?? 0, r.observed ?? 0]))
  const hasObserved = (observed.data?.by_category.length ?? 0) > 0

  /** "Use observed": copy the average into the planned category (creating a
   * discretionary category for observed-only rows). */
  function applyObserved(row: (typeof rows)[number]) {
    const amount = Math.round(row.observed ?? 0)
    const categories: SpendingCategory[] = row.categoryId
      ? spending.categories.map((c) => (c.id === row.categoryId ? { ...c, monthly_amount: amount } : c))
      : [
          ...spending.categories,
          { id: 0, name: row.name, monthly_amount: amount, kind: 'discretionary', annual_growth_pct: null },
        ]
    update.mutate([{ categories, monthly_savings_target: spending.monthly_savings_target }])
  }

  return (
    <Card>
      <CardHeader
        title="Observed spending"
        hint={
          observed.data
            ? `Outflows from imported transactions · trailing ${observed.data.months} months`
            : 'Outflows from imported transactions'
        }
        action={
          <div
            className="inline-flex rounded-(--radius-s) border border-edge bg-surface-3 p-0.5"
            role="radiogroup"
            aria-label="Observed window"
          >
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={months === w}
                onClick={() => setMonths(w)}
                className={`rounded-[calc(var(--radius-s)-2px)] px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                  months === w ? 'bg-surface text-ink shadow-1' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {w} mo
              </button>
            ))}
          </div>
        }
      />

      {observed.isPending ? (
        <div className="flex flex-col gap-2 px-5 pt-2 pb-5">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : !hasObserved ? (
        <EmptyState
          illustration="file"
          title="Nothing observed yet"
          hint="Import bank transactions and this panel shows what you actually spend, next to what you planned."
          action={
            <Link to="/import">
              <Button variant="subtle">Go to Import</Button>
            </Link>
          }
        />
      ) : (
        <div className={`flex flex-col px-5 pt-1 pb-4 ${observed.isFetching ? 'opacity-80' : ''} transition-opacity duration-150`}>
          <div className="mb-1 grid grid-cols-[1fr_auto] items-baseline gap-2 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-4 rounded-full bg-accent" /> planned
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: 'var(--chart-ref)' }} />{' '}
                observed
              </span>
            </span>
            <span>Δ observed − planned</span>
          </div>
          <ul className="divide-y divide-(--border)">
            {rows.map((row) => (
              <ObservedRow key={row.key} row={row} max={max} onUseObserved={() => applyObserved(row)} />
            ))}
          </ul>
          {observed.data ? (
            <div className="mt-1 flex items-center justify-between border-t border-edge pt-3 text-[13px]">
              <p className="font-medium text-ink">Observed total</p>
              <p className="num font-semibold text-ink">{formatMoney(observed.data.total_monthly_avg)}/mo</p>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}

function ObservedRow({
  row,
  max,
  onUseObserved,
}: {
  row: ReturnType<typeof mergeObservedPlanned>[number]
  max: number
  onUseObserved: () => void
}) {
  const delta = row.observed != null && row.planned != null ? row.observed - row.planned : null
  const over = delta != null && delta > 0
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="w-32 min-w-0 shrink-0">
        <p className="truncate text-[13px] text-ink">{row.name}</p>
        <p className="text-[11px] text-ink-3">
          {row.categoryId == null
            ? 'not planned'
            : row.observed == null
              ? 'no transactions'
              : `${row.txnCount} txns`}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1" aria-hidden>
        <Bar value={row.planned} max={max} color="var(--accent)" />
        <Bar value={row.observed} max={max} color="var(--chart-ref)" />
      </div>
      <div className="w-24 shrink-0 text-right">
        <p className="num text-[12px] text-ink-2">
          {row.planned != null ? formatMoney(row.planned) : '—'}
          <span className="text-ink-3"> / </span>
          {row.observed != null ? formatMoney(row.observed) : '—'}
        </p>
        {delta != null ? (
          <p className={`num text-[11px] font-medium ${over ? 'text-negative' : 'text-positive'}`}>
            {delta >= 0 ? '+' : '−'}
            {formatMoney(Math.abs(delta))}/mo
          </p>
        ) : null}
      </div>
      {row.observed != null ? (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onUseObserved}>
          Use observed
        </Button>
      ) : (
        <span className="w-[7.2rem] shrink-0" aria-hidden />
      )}
    </li>
  )
}

/** Thin comparison bar — 6px tall, 2px radius, min-width so tiny values show. */
function Bar({ value, max, color }: { value: number | null; max: number; color: string }) {
  return (
    <div className="h-1.5 min-w-0 rounded-full bg-surface-2">
      {value != null && value > 0 ? (
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (value / max) * 100).toFixed(1)}%`, background: color, minWidth: 3 }}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------ flows card -------------------------------- */

function FlowsCard({ flows }: { flows: Flow[] }) {
  const { data: members } = useHousehold()
  const patch = usePatchFlow()

  if (flows.length === 0) return null
  const kindBadge: Record<Flow['kind'], string> = {
    income: 'text-positive',
    expense: 'text-negative',
    contribution: 'text-accent',
  }

  return (
    <Card>
      <CardHeader
        title="Recurring flows"
        hint="Income, fixed payments, and contributions — assign an owner so retirement timing lands on the right person"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-left text-xs text-ink-3">
              <th className="px-5 py-2 font-medium">Flow</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="num px-4 py-2 text-right font-medium">Monthly</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Ends</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f) => (
              <tr key={f.id} className="border-b border-edge last:border-0">
                <td className="px-5 py-2 font-medium text-ink">{f.name}</td>
                <td className={`px-4 py-2 text-[12px] font-medium capitalize ${kindBadge[f.kind]}`}>{f.kind}</td>
                <td className="num px-4 py-2 text-right text-ink">{formatMoney(f.amount_monthly)}</td>
                <td className="px-4 py-2">
                  <Select
                    aria-label={`Owner of ${f.name}`}
                    value={f.member_id == null ? '' : String(f.member_id)}
                    onChange={(e) =>
                      patch.mutate([f.id, { member_id: e.target.value === '' ? null : Number(e.target.value) }])
                    }
                    className="h-8 w-36 text-[13px]"
                  >
                    <option value="">Household</option>
                    {(members ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-4 py-2 text-[12px] text-ink-3">
                  {f.end_date ? f.end_date.slice(0, 7) : f.ends_at_retirement ? 'at retirement' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* --------------------------- add category modal --------------------------- */

function AddCategoryModal({ spending, onClose }: { spending: SpendingProfile; onClose: () => void }) {
  const update = useUpdateSpending()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('300')
  const [kind, setKind] = useState<SpendingKind>('essential')

  const num = Number(amount.replace(/[$,\s]/g, ''))
  const valid = name.trim().length > 0 && Number.isFinite(num) && num >= 0

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || update.isPending) return
    update.mutate(
      [
        {
          categories: [
            ...spending.categories,
            { name: name.trim(), monthly_amount: num, kind, annual_growth_pct: null },
          ],
          monthly_savings_target: spending.monthly_savings_target,
        },
      ],
      { onSuccess: onClose },
    )
  }

  return (
    <Modal title="Add spending category" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name">
          {(id) => (
            <TextInput id={id} autoFocus value={name} placeholder="Groceries" onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly amount">
            {(id) => (
              <TextInput id={id} inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
            )}
          </Field>
          <Field label="Kind">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as SpendingKind)}>
                <option value="essential">Essential</option>
                <option value="discretionary">Discretionary</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || update.isPending}>
            {update.isPending ? 'Adding…' : 'Add category'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

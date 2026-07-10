import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  useCreateGoal,
  useDashboard,
  useDeleteGoal,
  useGoals,
  usePatchGoal,
  useProfile,
  useSimulation,
} from '@/api/queries'
import type { Goal, GoalCreate } from '@/api/types'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Field, TextInput, Select } from '@/components/Field'
import { Modal } from '@/components/Overlay'
import { Skeleton } from '@/components/Skeleton'
import { IconPencil, IconPlus, IconTrash } from '@/components/icons'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { PageHeader } from '@/layout/AppShell'

export function GoalsPage() {
  const { data: goals, isPending } = useGoals()
  const { data: dashboard } = useDashboard()
  const { data: profile } = useProfile()
  // Baseline simulation feeds date feasibility.
  const sim = useSimulation({}, { enabled: !!profile })
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)

  const sorted = useMemo(
    () => [...(goals ?? [])].sort((a, b) => a.priority - b.priority || a.id - b.id),
    [goals],
  )

  return (
    <>
      <PageHeader
        title="Goals"
        hint="Dreams with a number and a date"
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <IconPlus width={16} height={16} /> New goal
          </Button>
        }
      />

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            illustration="flag"
            title="What are you saving for?"
            hint="A sailboat, a sabbatical, a kitchen that doesn’t fight back. Give it a number and a date and we’ll tell you if the plan gets you there."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                <IconPlus width={16} height={16} /> Name a dream
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              monthlySurplus={dashboard?.monthly_surplus ?? null}
              simP50AtDate={p50AtDate(sim.data, profile?.birth_year, g.target_date)}
              onEdit={() => setEditing(g)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <GoalModal goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  )
}

function p50AtDate(
  sim: ReturnType<typeof useSimulation>['data'],
  birthYear: number | undefined,
  targetDate: string | null,
): number | null {
  if (!sim || !birthYear || !targetDate) return null
  const year = Number(targetDate.slice(0, 4))
  const idx = sim.ages.findIndex((a) => birthYear + a >= year)
  if (idx < 0) return null
  return sim.percentiles.p50[idx] ?? null
}

type Feasibility =
  | { tone: 'done'; label: string }
  | { tone: 'good' | 'ok' | 'risk'; label: string; monthly: number }
  | null

function feasibility(goal: Goal, surplus: number | null): Feasibility {
  const remaining = goal.target_amount - goal.funded_amount
  if (remaining <= 0) return { tone: 'done', label: 'Funded' }
  if (!goal.target_date || surplus === null) return null
  const months = monthsUntil(goal.target_date)
  if (months <= 0) return { tone: 'risk', label: 'Target date has passed', monthly: remaining }
  const monthly = remaining / months
  if (monthly <= surplus * 0.4)
    return { tone: 'good', label: `On track — ${formatMoney(monthly)}/mo does it`, monthly }
  if (monthly <= surplus)
    return { tone: 'ok', label: `Doable — needs ${formatMoney(monthly)}/mo of your surplus`, monthly }
  return { tone: 'risk', label: `At risk — needs ${formatMoney(monthly)}/mo, more than you free up`, monthly }
}

function monthsUntil(iso: string): number {
  const now = new Date()
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1))
}

function GoalCard({
  goal,
  monthlySurplus,
  simP50AtDate,
  onEdit,
}: {
  goal: Goal
  monthlySurplus: number | null
  simP50AtDate: number | null
  onEdit: () => void
}) {
  const del = useDeleteGoal()
  const pct = goal.target_amount > 0 ? Math.min(1, goal.funded_amount / goal.target_amount) : 0
  const feas = feasibility(goal, monthlySurplus)
  const toneCls =
    feas?.tone === 'risk' ? 'text-negative' : feas?.tone === 'ok' ? 'text-warning' : 'text-positive'

  return (
    <Card className="group flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-(--radius-s) bg-surface-2 text-xl">
            {goal.emoji || '🎯'}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{goal.name}</p>
            <p className="text-xs text-ink-3">
              {goal.target_date ? `by ${formatMonthYear(goal.target_date)}` : 'someday'} · priority {goal.priority}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${goal.name}`}>
            <IconPencil width={15} height={15} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => del.mutate([goal.id])}
            aria-label={`Delete ${goal.name}`}
          >
            <IconTrash width={15} height={15} />
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <p className="num text-lg font-semibold text-ink">{formatMoney(goal.funded_amount)}</p>
          <p className="num text-xs text-ink-3">of {formatMoney(goal.target_amount)}</p>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-(--ease-out)"
            style={{ width: `${(pct * 100).toFixed(1)}%` }}
          />
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-0.5">
        {feas ? <p className={`text-xs font-medium ${feas.tone === 'done' ? 'text-positive' : toneCls}`}>{feas.label}</p> : null}
        {simP50AtDate !== null ? (
          <p className="num text-[11px] text-ink-3">
            Median net worth then ≈ {formatMoney(simP50AtDate)}
          </p>
        ) : null}
        {goal.notes ? <p className="text-[11px] text-ink-3 italic">“{goal.notes}”</p> : null}
      </div>
    </Card>
  )
}

function GoalModal({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const create = useCreateGoal()
  const patch = usePatchGoal()
  const [form, setForm] = useState<GoalCreate>({
    name: goal?.name ?? '',
    emoji: goal?.emoji ?? '⭐',
    target_amount: goal?.target_amount ?? 10000,
    target_date: goal?.target_date ?? null,
    priority: goal?.priority ?? 2,
    funded_amount: goal?.funded_amount ?? 0,
    notes: goal?.notes ?? '',
  })
  const busy = create.isPending || patch.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    if (goal) patch.mutate([goal.id, form], { onSuccess: onClose })
    else create.mutate([form], { onSuccess: onClose })
  }

  return (
    <Modal title={goal ? `Edit ${goal.name}` : 'New goal'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[4.5rem_1fr] gap-3">
          <Field label="Emoji">
            {(id) => (
              <TextInput
                id={id}
                value={form.emoji}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                className="text-center"
              />
            )}
          </Field>
          <Field label="Name">
            {(id) => (
              <TextInput
                id={id}
                autoFocus={!goal}
                value={form.name}
                placeholder="Sailboat"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target amount">
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                className="num"
                value={String(form.target_amount)}
                onChange={(e) =>
                  setForm({ ...form, target_amount: Number(e.target.value.replace(/[$,\s]/g, '')) || 0 })
                }
              />
            )}
          </Field>
          <Field label="Saved so far">
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                className="num"
                value={String(form.funded_amount)}
                onChange={(e) =>
                  setForm({ ...form, funded_amount: Number(e.target.value.replace(/[$,\s]/g, '')) || 0 })
                }
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target date" hint="Optional">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.target_date ?? ''}
                onChange={(e) => setForm({ ...form, target_date: e.target.value || null })}
              />
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select
                id={id}
                value={String(form.priority)}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              >
                <option value="1">1 — must happen</option>
                <option value="2">2 — really want it</option>
                <option value="3">3 — would be lovely</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Notes" hint="Optional">
          {(id) => (
            <TextInput
              id={id}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          )}
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!form.name.trim() || busy}>
            {busy ? 'Saving…' : goal ? 'Save changes' : 'Add goal'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Tracking (v1.3, #21): am I ahead or behind the plan I saved? A snapshot
 * list with a capture action, the benchmark's plan line overlaid with actuals
 * per metric, a headline delta, and the model-honest "within normal range"
 * framing. Attention rules: status is shown where you look, never nagged. */

import { useEffect, useMemo, useState } from 'react'
import type { PlanMeta, TrackingMetric } from '@/api/types'
import {
  useCreateSnapshot,
  useDeleteSnapshot,
  usePlanTracking,
  usePlans,
  useSetBenchmark,
} from '@/api/queries'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import { IconPlus, IconTrash } from '@/components/icons'
import { formatDate, formatMoney } from '@/lib/format'
import { PageHeader } from '@/layout/AppShell'
import { TrackingChart } from './TrackingChart'
import { statusPhrase, statusTone } from './status'

const METRICS: { key: TrackingMetric; label: string }[] = [
  { key: 'net_worth', label: 'Net worth' },
  { key: 'spending', label: 'Spending' },
  { key: 'saving', label: 'Saving' },
]

export function TrackingPage() {
  const plans = usePlans()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [metric, setMetric] = useState<TrackingMetric>('net_worth')

  // Default the selection to the benchmark, else the newest snapshot.
  useEffect(() => {
    if (!plans.data || plans.data.length === 0) return
    if (selectedId != null && plans.data.some((p) => p.id === selectedId)) return
    const benchmark = plans.data.find((p) => p.is_benchmark)
    setSelectedId((benchmark ?? plans.data[0]!).id)
  }, [plans.data, selectedId])

  if (plans.isPending) return <TrackingSkeleton />

  const list = plans.data ?? []
  if (list.length === 0) {
    return (
      <>
        <PageHeader
          title="Tracking"
          hint="Save a plan, then watch real life track against it."
        />
        <Card>
          <EmptyState
            illustration="chart"
            title="Capture a plan to track against"
            hint="A snapshot freezes today’s projection — net worth, spending, saving. Later, this page shows whether you’re ahead of it, behind it, or just riding normal market variance."
            action={<CaptureButton onCaptured={setSelectedId} label="Capture current plan" />}
          />
        </Card>
      </>
    )
  }

  const selected = list.find((p) => p.id === selectedId) ?? list[0]!

  return (
    <>
      <PageHeader
        title="Tracking"
        hint="How real life is tracking against the plans you saved."
        action={<CaptureButton onCaptured={setSelectedId} label="Capture current plan" />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SnapshotList
            plans={list}
            selectedId={selected.id}
            onSelect={setSelectedId}
          />
        </div>

        <div className="lg:col-span-2">
          <TrackingPanel plan={selected} metric={metric} onMetric={setMetric} />
        </div>
      </div>
    </>
  )
}

function CaptureButton({
  onCaptured,
  label,
}: {
  onCaptured: (id: number) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const create = useCreateSnapshot()

  function submit() {
    const trimmed = name.trim() || defaultName()
    create.mutate([{ name: trimmed }], {
      onSuccess: (plan) => {
        onCaptured(plan.id)
        setOpen(false)
        setName('')
      },
    })
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <IconPlus width={16} height={16} /> {label}
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={defaultName()}
        aria-label="Snapshot name"
        className="h-9 w-52 rounded-(--radius-s) border border-edge bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <Button variant="primary" onClick={submit} disabled={create.isPending}>
        {create.isPending ? 'Capturing…' : 'Capture'}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)} disabled={create.isPending}>
        Cancel
      </Button>
    </div>
  )
}

function defaultName(): string {
  const d = new Date()
  return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()} plan`
}

function SnapshotList({
  plans,
  selectedId,
  onSelect,
}: {
  plans: PlanMeta[]
  selectedId: number
  onSelect: (id: number) => void
}) {
  const setBenchmark = useSetBenchmark()
  const remove = useDeleteSnapshot()

  return (
    <Card>
      <CardHeader title="Saved plans" hint="One is the benchmark you compare against." />
      <ul className="flex flex-col px-2 pt-1 pb-2">
        {plans.map((p) => {
          const active = p.id === selectedId
          return (
            <li key={p.id}>
              <div
                className={`group flex items-start gap-2 rounded-(--radius-s) px-3 py-2.5 transition-colors ${
                  active ? 'bg-accent-soft' : 'hover:bg-surface-2'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="min-w-0 flex-1 text-left"
                  aria-current={active}
                >
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                    {p.is_benchmark ? (
                      <span className="text-accent" title="Benchmark" aria-label="Benchmark">
                        ★
                      </span>
                    ) : null}
                    {p.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {formatDate(p.created_at.slice(0, 10))} · {formatMoney(p.captured_net_worth)}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {!p.is_benchmark ? (
                    <button
                      type="button"
                      onClick={() => setBenchmark.mutate([p.id, true])}
                      className="rounded-(--radius-s) px-1.5 py-1 text-[11px] font-medium text-ink-3 opacity-0 transition group-hover:opacity-100 hover:bg-surface-3 hover:text-accent"
                      title="Set as benchmark"
                    >
                      Set benchmark
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove.mutate([p.id])}
                    className="rounded-(--radius-s) p-1 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:bg-surface-3 hover:text-negative"
                    title="Delete snapshot"
                    aria-label={`Delete ${p.name}`}
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function TrackingPanel({
  plan,
  metric,
  onMetric,
}: {
  plan: PlanMeta
  metric: TrackingMetric
  onMetric: (m: TrackingMetric) => void
}) {
  const tracking = usePlanTracking(plan.id, metric)

  const headline = useMemo(() => {
    if (!tracking.data) return null
    return statusPhrase(metric, tracking.data.delta_now, tracking.data.status)
  }, [tracking.data, metric])
  const tone = statusTone(tracking.data?.status ?? null)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div>
          <p className="text-xs font-medium text-ink-3">
            Tracking against <span className="text-ink-2">{plan.name}</span>
            {plan.is_benchmark ? ' · benchmark' : ''}
          </p>
          <p className={`num mt-1 text-2xl font-semibold ${tone}`}>
            {headline ?? '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Captured {formatDate(plan.created_at.slice(0, 10))}
          </p>
        </div>
        <MetricSwitcher metric={metric} onMetric={onMetric} />
      </div>

      <div className="px-5 pb-2">
        {tracking.isPending ? (
          <Skeleton className="h-64" />
        ) : tracking.data && tracking.data.actual.length >= 2 ? (
          <TrackingChart tracking={tracking.data} metric={metric} />
        ) : (
          <div className="py-10 text-center text-[13px] text-ink-3">
            Not enough actual data since this snapshot yet — check back after a
            month or two of fresh balances and transactions.
          </div>
        )}
      </div>

      {metric === 'net_worth' && tracking.data?.band ? (
        <NormalRangeNote status={tracking.data.status} />
      ) : null}
    </Card>
  )
}

function MetricSwitcher({
  metric,
  onMetric,
}: {
  metric: TrackingMetric
  onMetric: (m: TrackingMetric) => void
}) {
  return (
    <div
      className="inline-flex rounded-(--radius-s) border border-edge bg-surface-2 p-0.5"
      role="tablist"
      aria-label="Tracking metric"
    >
      {METRICS.map((m) => (
        <button
          key={m.key}
          type="button"
          role="tab"
          aria-selected={metric === m.key}
          onClick={() => onMetric(m.key)}
          className={`rounded-[calc(var(--radius-s)-2px)] px-3 py-1 text-[13px] font-medium transition-colors ${
            metric === m.key ? 'bg-surface text-ink shadow-1' : 'text-ink-3 hover:text-ink'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

/** Model-honesty note (assumptions-strip precedent): being below the plan line
 * but inside the p25–p75 band is normal market variance, not failure. */
function NormalRangeNote({ status }: { status: string | null }) {
  const withinRange = status === 'within_normal_range'
  return (
    <div className="border-t border-edge px-5 py-3 text-[11px] leading-relaxed text-ink-3">
      {withinRange ? (
        <span className="text-ink-2">
          You’re below the expected line but inside the plan’s normal range —
          that’s ordinary market variance, not falling behind.
        </span>
      ) : (
        'The shaded band is the plan’s normal range (p25–p75). Drifting inside it is expected month to month — only leaving it below is “behind.”'
      )}
    </div>
  )
}

function TrackingSkeleton() {
  return (
    <>
      <PageHeader title="Tracking" hint="How real life is tracking against the plans you saved." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-1" />
        <Skeleton className="h-96 lg:col-span-2" />
      </div>
    </>
  )
}

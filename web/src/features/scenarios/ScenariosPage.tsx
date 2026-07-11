/** Scenario studio — parameter panel, event chips, live fan chart with
 * debounced re-simulation, success gauge, and compare mode with pinning. */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useCompare,
  useCreateScenario,
  useDeleteScenario,
  useHousehold,
  usePatchScenario,
  useProfile,
  useScenarios,
  useSimulation,
} from '@/api/queries'
import type { HouseholdMember, Scenario, ScenarioEvent, ScenarioParams } from '@/api/types'
import { FanChart } from '@/charts/FanChart'
import type { FanChartSeries } from '@/charts/FanChart'
import { toMarkers } from '@/charts/milestones'
import type { MarkerDatum } from '@/charts/milestones'
import { ProbabilityGauge } from '@/charts/Gauge'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { Field, Select, TextInput, Toggle } from '@/components/Field'
import { Modal } from '@/components/Overlay'
import { Skeleton } from '@/components/Skeleton'
import { Slider } from '@/components/Slider'
import { IconCheck, IconPin, IconPlus, IconX } from '@/components/icons'
import { formatMoney, formatMoneyCompact, formatProbability } from '@/lib/format'
import { cleanParams, paramsEqual, serializeParams } from '@/lib/scenarioParams'
import { useDebounced } from '@/lib/useDebounced'
import { PageHeader } from '@/layout/AppShell'

const CHART_SLOTS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
] as const

export function ScenariosPage() {
  const { data: scenarios, isPending: scenariosPending } = useScenarios()
  const { data: profile } = useProfile()
  const { data: household } = useHousehold()
  const self = household?.find((m) => m.role === 'self')

  const [activeId, setActiveId] = useState(0)
  const [draft, setDraft] = useState<ScenarioParams>({})
  const loadedFor = useRef<number | null>(null)

  // Pinned scenarios keep their color slot for their lifetime (color follows
  // the entity — unpinning one never recolors the others).
  const [pinned, setPinned] = useState<{ id: number; slot: number }[]>([])
  const [compareBands, setCompareBands] = useState(false)

  const active = useMemo(
    () => scenarios?.find((s) => s.id === activeId) ?? scenarios?.[0],
    [scenarios, activeId],
  )

  useEffect(() => {
    if (active && loadedFor.current !== active.id) {
      loadedFor.current = active.id
      setDraft(active.params)
    }
  }, [active])

  const debouncedParams = useDebounced(draft, 300, serializeParams(draft))
  const sim = useSimulation(debouncedParams, { enabled: !!profile })

  const compareIds = pinned.map((p) => p.id)
  const compare = useCompare(compareIds, pinned.length >= 2)
  const comparing = pinned.length >= 2

  if (scenariosPending || !profile || !active || !self) {
    return (
      <>
        <PageHeader title="Scenario studio" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-[480px]" />
          <Skeleton className="h-[480px]" />
        </div>
      </>
    )
  }

  const dirty = !paramsEqual(draft, active.params)
  const retirementAge = draft.retirement_age ?? self.retirement_age ?? 65
  const spending = draft.annual_retirement_spending ?? profile.annual_retirement_spending
  const savingsDelta = draft.monthly_savings_delta ?? 0

  function togglePin(id: number) {
    setPinned((prev) => {
      const existing = prev.find((p) => p.id === id)
      if (existing) return prev.filter((p) => p.id !== id)
      if (prev.length >= CHART_SLOTS.length) return prev
      const used = new Set(prev.map((p) => p.slot))
      let slot = 0
      while (used.has(slot)) slot++
      return [...prev, { id, slot }]
    })
  }

  return (
    <>
      <PageHeader
        title="Scenario studio"
        hint="Drag a slider, watch your future move"
        action={
          <div className="flex items-center gap-2">
            {pinned.length > 0 ? (
              <span className="text-xs text-ink-3">
                {pinned.length} pinned{comparing ? ' · comparing' : ' — pin one more to compare'}
              </span>
            ) : null}
          </div>
        }
      />

      <ScenarioTabs
        scenarios={scenarios ?? []}
        activeId={active.id}
        pinnedIds={compareIds}
        onSelect={(id) => setActiveId(id)}
        onTogglePin={togglePin}
      />

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_1fr]">
        {/* ------------------------------ params ---------------------------- */}
        <Card className="lg:sticky lg:top-6">
          <CardHeader
            title={active.is_baseline ? 'What if…' : active.name}
            hint={active.is_baseline ? 'Tweaks are a diff against your real plan' : active.description || undefined}
          />
          <div className="flex flex-col gap-5 px-5 pt-2 pb-5">
            <Slider
              label="Retirement age"
              value={retirementAge}
              min={45}
              max={75}
              format={(v) => String(v)}
              onChange={(v) => setDraft({ ...draft, retirement_age: v })}
            />
            <Slider
              label="Monthly savings"
              value={savingsDelta}
              min={-3000}
              max={3000}
              step={100}
              format={(v) => (v === 0 ? 'as today' : `${v > 0 ? '+' : '−'}${formatMoney(Math.abs(v))}/mo`)}
              onChange={(v) => setDraft({ ...draft, monthly_savings_delta: v })}
              hint="Relative to what you save now"
            />
            <Slider
              label="Retirement spending"
              value={spending}
              min={30000}
              max={160000}
              step={2500}
              format={(v) => `${formatMoneyCompact(v)}/yr`}
              onChange={(v) => setDraft({ ...draft, annual_retirement_spending: v })}
            />

            <EventChips
              events={draft.events ?? []}
              currentAge={new Date().getFullYear() - self.birth_year}
              retirementAge={retirementAge}
              onChange={(events) => setDraft({ ...draft, events })}
            />

            <SaveControls
              active={active}
              draft={draft}
              dirty={dirty}
              onSaved={(s) => {
                loadedFor.current = s.id
                setActiveId(s.id)
                setDraft(s.params)
              }}
              onReverted={() => setDraft(active.params)}
            />
          </div>
        </Card>

        {/* ------------------------------ results --------------------------- */}
        <div className="flex min-w-0 flex-col gap-4">
          {comparing && compare.data ? (
            <CompareView
              results={compare.data.results}
              pinned={pinned}
              activeId={active.id}
              household={household ?? []}
              showBands={compareBands}
              onToggleBands={setCompareBands}
              onUnpin={togglePin}
            />
          ) : (
            <SingleView
              simData={sim.data}
              isFetching={sim.isFetching}
              household={household ?? []}
              scenarioName={active.is_baseline && dirty ? 'Draft' : active.name}
            />
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------- tabs ------------------------------------ */

function ScenarioTabs({
  scenarios,
  activeId,
  pinnedIds,
  onSelect,
  onTogglePin,
}: {
  scenarios: Scenario[]
  activeId: number
  pinnedIds: number[]
  onSelect: (id: number) => void
  onTogglePin: (id: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Scenarios">
      {scenarios.map((s) => {
        const selected = s.id === activeId
        const pinnedHere = pinnedIds.includes(s.id)
        return (
          <span
            key={s.id}
            className={`inline-flex items-center overflow-hidden rounded-full border text-[13px] transition-colors duration-150 ${
              selected ? 'border-transparent bg-accent-soft text-ink' : 'border-edge bg-surface text-ink-2 hover:text-ink'
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(s.id)}
              className="py-1.5 pr-1 pl-3.5 font-medium"
            >
              {s.name}
            </button>
            <button
              type="button"
              onClick={() => onTogglePin(s.id)}
              aria-label={pinnedHere ? `Unpin ${s.name}` : `Pin ${s.name} for comparison`}
              aria-pressed={pinnedHere}
              title={pinnedHere ? 'Unpin' : 'Pin to compare'}
              className={`px-2 py-1.5 transition-colors duration-150 ${pinnedHere ? 'text-accent' : 'text-ink-3 hover:text-ink'}`}
            >
              <IconPin width={14} height={14} />
            </button>
          </span>
        )
      })}
    </div>
  )
}

/* ---------------------------- single result ------------------------------ */

/** Household lookup for compact marker chips (first names). */
function markersFor(
  milestones: Parameters<typeof toMarkers>[0] | undefined,
  household: HouseholdMember[],
): MarkerDatum[] {
  if (!milestones || milestones.length === 0) return []
  return toMarkers(milestones, (id) => household.find((m) => m.id === id)?.name)
}

function SingleView({
  simData,
  isFetching,
  household,
  scenarioName,
}: {
  simData: ReturnType<typeof useSimulation>['data']
  isFetching: boolean
  household: HouseholdMember[]
  scenarioName: string
}) {
  if (!simData) {
    return (
      <>
        <Skeleton className="h-28" />
        <Skeleton className="h-96" />
      </>
    )
  }
  const series: FanChartSeries[] = [
    {
      name: scenarioName,
      color: 'var(--chart-1)',
      percentiles: simData.percentiles,
      deterministic: simData.deterministic.net_worth,
      showBands: true,
    },
  ]
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-around gap-x-8 gap-y-4 px-6 py-4">
          <ProbabilityGauge probability={simData.success_probability} />
          <EndStat label="Lean (10th)" value={simData.ending_net_worth.p10} />
          <EndStat label="Median outcome" value={simData.ending_net_worth.p50} big />
          <EndStat label="Flush (90th)" value={simData.ending_net_worth.p90} />
        </div>
        {simData.median_ruin_age !== null ? (
          <p className="border-t border-edge px-6 py-2.5 text-[13px] text-warning">
            In the paths that run dry, the money typically lasts to age {simData.median_ruin_age}.
          </p>
        ) : null}
      </Card>

      <Card className={isFetching ? 'opacity-90 transition-opacity duration-150' : 'transition-opacity duration-150'}>
        <CardHeader
          title="Projected net worth"
          hint="Shaded: 10–90th and 25–75th percentile outcomes · dashed: expected path · flags: life milestones"
        />
        <div className="px-4 pt-1 pb-4">
          <FanChart
            series={series}
            ages={simData.ages}
            startYear={simData.start_year}
            milestones={markersFor(simData.milestones, household)}
            height={360}
          />
        </div>
      </Card>
    </>
  )
}

function EndStat({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className={`num mt-0.5 font-semibold text-ink ${big ? 'text-2xl' : 'text-lg'}`}>
        {formatMoneyCompact(value)}
      </p>
      <p className="text-[10px] text-ink-3">at end of plan</p>
    </div>
  )
}

/* ------------------------------ compare ---------------------------------- */

function CompareView({
  results,
  pinned,
  activeId,
  household,
  showBands,
  onToggleBands,
  onUnpin,
}: {
  results: (ReturnType<typeof useSimulation>['data'] & { scenario_id: number; name: string })[]
  pinned: { id: number; slot: number }[]
  activeId: number
  household: HouseholdMember[]
  showBands: boolean
  onToggleBands: (v: boolean) => void
  onUnpin: (id: number) => void
}) {
  const colorFor = (id: number) =>
    CHART_SLOTS[pinned.find((p) => p.id === id)?.slot ?? 0] ?? CHART_SLOTS[0]

  const first = results[0]
  if (!first) return null
  const series: FanChartSeries[] = results.map((r) => ({
    name: r!.name,
    color: colorFor(r!.scenario_id),
    percentiles: r!.percentiles,
    showBands,
  }))

  // Milestones of ONE scenario only — the active one if pinned, else the
  // first pinned. Overlaying every pinned scenario's marker set (even dimmed)
  // turns to clutter beyond two scenarios; decision logged in T-006.
  const milestoneSource = results.find((r) => r!.scenario_id === activeId) ?? first
  const markers = markersFor(milestoneSource!.milestones, household)

  return (
    <>
      <Card>
        <CardHeader
          title="Compare scenarios"
          hint={`Median paths overlaid — shared probe reads all of them · milestones: ${milestoneSource!.name}`}
          action={
            <label className="flex items-center gap-2 text-xs text-ink-2">
              Bands
              <Toggle checked={showBands} onChange={onToggleBands} label="Show percentile bands" />
            </label>
          }
        />
        <div className="px-4 pt-1 pb-4">
          <FanChart
            series={series}
            ages={first!.ages}
            startYear={first!.start_year}
            milestones={markers}
            height={360}
            ariaLabel="Scenario comparison chart"
          />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs text-ink-3">
                <th className="px-5 py-2.5 font-medium">Scenario</th>
                <th className="num px-4 py-2.5 text-right font-medium">Success</th>
                <th className="num px-4 py-2.5 text-right font-medium">Median ending</th>
                <th className="num px-4 py-2.5 text-right font-medium">10th pct</th>
                <th className="num px-4 py-2.5 text-right font-medium">Ruin age</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r!.scenario_id} className="border-b border-edge last:border-0">
                  <td className="px-5 py-2.5">
                    <span className="inline-flex items-center gap-2 font-medium text-ink">
                      <span className="h-0.5 w-4 rounded-full" style={{ background: colorFor(r!.scenario_id) }} />
                      {r!.name}
                    </span>
                  </td>
                  <td className="num px-4 py-2.5 text-right font-semibold text-ink">
                    {formatProbability(r!.success_probability)}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-ink">{formatMoneyCompact(r!.ending_net_worth.p50)}</td>
                  <td className="num px-4 py-2.5 text-right text-ink-2">{formatMoneyCompact(r!.ending_net_worth.p10)}</td>
                  <td className="num px-4 py-2.5 text-right text-ink-2">{r!.median_ruin_age ?? '—'}</td>
                  <td className="px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => onUnpin(r!.scenario_id)}
                      aria-label={`Unpin ${r!.name}`}
                      className="rounded p-1 text-ink-3 hover:text-ink"
                    >
                      <IconX width={14} height={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

/* ---------------------------- event chips --------------------------------- */

const EVENT_PRESETS: (Omit<ScenarioEvent, 'start_age' | 'age'> & { atRetirement?: boolean })[] = [
  { name: 'Take up golf', kind: 'recurring_expense', amount_monthly: 350 },
  { name: 'Sell the boat', kind: 'one_time', amount: 25000 },
  { name: 'Buy a camper', kind: 'one_time', amount: -45000 },
  { name: 'Consulting on the side', kind: 'recurring_income', amount_monthly: 2000, atRetirement: true },
]

function EventChips({
  events,
  currentAge,
  retirementAge,
  onChange,
}: {
  events: ScenarioEvent[]
  currentAge: number
  retirementAge: number
  onChange: (events: ScenarioEvent[]) => void
}) {
  const [editing, setEditing] = useState(false)

  function addPreset(p: (typeof EVENT_PRESETS)[number]) {
    const startAge = p.atRetirement ? retirementAge + 1 : currentAge + 1
    const e: ScenarioEvent =
      p.kind === 'one_time'
        ? { name: p.name, kind: p.kind, amount: p.amount, age: Math.max(startAge, currentAge + 1) + (p.name === 'Sell the boat' ? 10 : 0) }
        : { name: p.name, kind: p.kind, amount_monthly: p.amount_monthly, start_age: startAge, end_age: p.kind === 'recurring_income' ? startAge + 5 : null }
    onChange([...events, e])
  }

  const unused = EVENT_PRESETS.filter((p) => !events.some((e) => e.name === p.name))

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-2">Life events</p>
      <div className="flex flex-wrap gap-1.5">
        {events.map((e, i) => (
          <span
            key={`${e.name}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-1 pr-1 pl-3 text-xs font-medium text-ink"
            title={eventSummary(e)}
          >
            {e.name}
            <span className="num text-ink-2">{eventAmount(e)}</span>
            <button
              type="button"
              onClick={() => onChange(events.filter((_, j) => j !== i))}
              aria-label={`Remove event ${e.name}`}
              className="rounded-full p-0.5 text-ink-3 hover:text-ink"
            >
              <IconX width={12} height={12} />
            </button>
          </span>
        ))}
        {unused.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => addPreset(p)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-edge-strong px-3 py-1 text-xs text-ink-3 transition-colors duration-150 hover:border-(--accent) hover:text-ink"
          >
            <IconPlus width={12} height={12} /> {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-edge-strong px-3 py-1 text-xs text-ink-3 transition-colors duration-150 hover:border-(--accent) hover:text-ink"
        >
          <IconPlus width={12} height={12} /> Custom…
        </button>
      </div>
      {editing ? (
        <EventModal
          currentAge={currentAge}
          onAdd={(e) => {
            onChange([...events, e])
            setEditing(false)
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}

function eventAmount(e: ScenarioEvent): string {
  if (e.kind === 'one_time') return formatMoneyCompact(e.amount ?? 0)
  const v = e.amount_monthly ?? 0
  return `${e.kind === 'recurring_expense' ? '−' : '+'}${formatMoneyCompact(Math.abs(v))}/mo`
}

function eventSummary(e: ScenarioEvent): string {
  if (e.kind === 'one_time') return `${formatMoney(e.amount ?? 0)} at age ${e.age}`
  return `${formatMoney(e.amount_monthly ?? 0)}/mo from age ${e.start_age}${e.end_age ? ` to ${e.end_age}` : ' on'}`
}

function EventModal({
  currentAge,
  onAdd,
  onClose,
}: {
  currentAge: number
  onAdd: (e: ScenarioEvent) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ScenarioEvent['kind']>('recurring_expense')
  const [amount, setAmount] = useState('300')
  const [startAge, setStartAge] = useState(String(currentAge + 1))
  const [endAge, setEndAge] = useState('')

  const oneTime = kind === 'one_time'
  const num = Number(amount.replace(/[$,\s]/g, ''))
  const valid = name.trim().length > 0 && Number.isFinite(num) && Number(startAge) >= currentAge

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    // one_time.amount stays signed as entered; recurring amounts are positive
    // magnitudes — direction implied by kind (contract ruling 2026-07-10).
    onAdd(
      oneTime
        ? { name: name.trim(), kind, amount: num, age: Number(startAge) }
        : {
            name: name.trim(),
            kind,
            amount_monthly: Math.abs(num),
            start_age: Number(startAge),
            end_age: endAge === '' ? null : Number(endAge),
          },
    )
  }

  return (
    <Modal title="Add life event" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name">
          {(id) => (
            <TextInput id={id} autoFocus value={name} placeholder="Sabbatical year" onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as ScenarioEvent['kind'])}>
                <option value="recurring_expense">Recurring expense</option>
                <option value="recurring_income">Recurring income</option>
                <option value="one_time">One-time</option>
              </Select>
            )}
          </Field>
          <Field label={oneTime ? 'Amount (− = money out)' : 'Monthly amount'}>
            {(id) => <TextInput id={id} inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={oneTime ? 'At age' : 'From age'}>
            {(id) => <TextInput id={id} inputMode="numeric" className="num" value={startAge} onChange={(e) => setStartAge(e.target.value)} />}
          </Field>
          {!oneTime ? (
            <Field label="Until age" hint="Blank = for good">
              {(id) => <TextInput id={id} inputMode="numeric" className="num" value={endAge} onChange={(e) => setEndAge(e.target.value)} />}
            </Field>
          ) : null}
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!valid}>
            Add event
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/* ---------------------------- save controls ------------------------------- */

function SaveControls({
  active,
  draft,
  dirty,
  onSaved,
  onReverted,
}: {
  active: Scenario
  draft: ScenarioParams
  dirty: boolean
  onSaved: (s: Scenario) => void
  onReverted: () => void
}) {
  const create = useCreateScenario()
  const patch = usePatchScenario()
  const del = useDeleteScenario()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  function saveAsNew() {
    create.mutate(
      [{ name: name.trim() || 'Untitled scenario', description: '', params: cleanParams(draft) }],
      {
        onSuccess: (s) => {
          setNaming(false)
          setName('')
          onSaved(s)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-2 border-t border-edge pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {!active.is_baseline ? (
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || patch.isPending}
            onClick={() =>
              patch.mutate([active.id, { params: cleanParams(draft) }], {
                onSuccess: (s) => onSaved(s),
              })
            }
          >
            <IconCheck width={14} height={14} /> {patch.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        ) : null}
        <Button variant={active.is_baseline && dirty ? 'primary' : 'subtle'} size="sm" onClick={() => setNaming(true)}>
          <IconPlus width={14} height={14} /> Save as new
        </Button>
        {dirty ? (
          <Button variant="ghost" size="sm" onClick={onReverted}>
            Revert
          </Button>
        ) : null}
        {!active.is_baseline ? (
          <Button variant="danger" size="sm" disabled={del.isPending} onClick={() => del.mutate([active.id], { onSuccess: () => onSaved({ id: 0, name: 'Current trajectory', description: '', is_baseline: true, params: {} }) })}>
            Delete
          </Button>
        ) : null}
      </div>
      {active.is_baseline && !dirty ? (
        <p className="text-[11px] leading-relaxed text-ink-3">
          This is your current trajectory. Nudge a slider or add an event, then save it as a named scenario.
        </p>
      ) : null}

      {naming ? (
        <Modal title="Name this scenario" onClose={() => setNaming(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              saveAsNew()
            }}
            className="flex flex-col gap-4"
          >
            <Field label="Name">
              {(id) => (
                <TextInput id={id} autoFocus value={name} placeholder="Retire at 58, more travel" onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNaming(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? 'Saving…' : 'Save scenario'}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

/** #29 forecast honesty — "how this is computed" strip + per-month breakdown.
 *
 * The model-honesty pattern (AssumptionsStrip) extended to the spending
 * forecast: quiet, collapsible chart chrome in ink tones that explains the
 * projection's mechanics, plus a month-by-month component list synced with
 * the chart probe.
 *
 * Every AMOUNT comes from the /spending/forecast and /spending/recurring
 * responses joined client-side (see ./forecastView.ts) — nothing is
 * re-derived, so the panel can never drift from the chart. The only
 * client-side derivations are date LABELS: the projection starts the month
 * after the current one (contract: months are full future months), so the
 * current month and the 6-full-month variable lookback window both fall out
 * of `months[0]` by calendar arithmetic. Annual charges land in forecast
 * months whose calendar month matches the charge's `last_date` — the same
 * anniversary rule the server uses to build `recurring[]`. */

import { useState } from 'react'
import type { RecurringCharge, SpendingForecast } from '@/api/types'
import { IconChevronRight } from '@/components/icons'
import { formatMoney } from '@/lib/format'
import {
  firstDayLabel,
  lastDayLabel,
  longMonthKey,
  monthNameOf,
  round2,
  shortMonthKey,
} from './forecastView'
import type { ForecastView } from './forecastView'

const EXPAND_KEY = 'gol.forecastExplain.expanded'

/* -------------------------- "how this is computed" ------------------------ */

const CADENCE_LABEL: Record<RecurringCharge['cadence'], string> = {
  monthly: 'monthly',
  weekly: 'weekly',
  annual: 'annual',
}

export function ForecastExplain({ view }: { view: ForecastView }) {
  const [expanded, setExpanded] = useState(() => sessionStorage.getItem(EXPAND_KEY) === '1')
  const toggle = () =>
    setExpanded((v) => {
      sessionStorage.setItem(EXPAND_KEY, v ? '0' : '1')
      return !v
    })

  const activeCount = view.steady.length + view.annual.length
  const summary = [
    `${activeCount} recurring ${activeCount === 1 ? 'charge' : 'charges'} at cadence`,
    `variable = 6-month averages (${shortMonthKey(view.windowFromKey)}–${shortMonthKey(view.windowToKey)})`,
    `${view.months.length} projected months`,
  ].join(' · ')

  return (
    <div className="border-t border-edge">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-5 py-2 text-left text-[11px] text-ink-3 transition-colors duration-150 hover:text-ink-2"
      >
        <IconChevronRight
          width={10}
          height={10}
          className={`shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="truncate">How this is computed: {summary}</span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-4 px-5 pt-1 pb-4">
          <section aria-label="Recurring components">
            <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              Recurring charges in the projection
            </h4>
            <dl className="flex flex-col gap-1.5 text-xs leading-relaxed">
              {view.steady.map((c) => (
                <Row key={c.payee} term={c.payee}>
                  {CADENCE_LABEL[c.cadence]} — counted at{' '}
                  <span className="num">{formatMoney(c.monthly_equivalent, { cents: true })}</span>/mo in every
                  month
                </Row>
              ))}
              {view.annual.map((c) => (
                <Row key={c.payee} term={c.payee}>
                  annual — <span className="num">{formatMoney(c.last_amount, { cents: true })}</span> lands in{' '}
                  {monthNameOf(c.last_date)}, its anniversary month
                </Row>
              ))}
            </dl>
            {view.lapsed.length > 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                {view.lapsed.length} lapsed {view.lapsed.length === 1 ? 'charge' : 'charges'} (
                {view.lapsed
                  .slice(0, 3)
                  .map((c) => c.payee)
                  .join(', ')}
                {view.lapsed.length > 3 ? ', …' : ''}
                ) excluded — not seen recently enough to still count as active.
              </p>
            ) : null}
          </section>

          <section aria-label="Variable derivation">
            <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              Where the variable numbers come from
            </h4>
            <p className="text-xs leading-relaxed text-ink-3">
              Each category&rsquo;s variable spending is its average over the last 6 full months —{' '}
              {firstDayLabel(view.windowFromKey)} through {lastDayLabel(view.windowToKey)}. The current month is
              left out of the window, and payments to the recurring payees above are excluded so nothing is
              counted twice. That average repeats unchanged in every projected month.
            </p>
          </section>

          <section aria-label="Projection window">
            <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              Which months are projected
            </h4>
            <p className="text-xs leading-relaxed text-ink-3">
              All {view.months.length} columns are projected full months, starting{' '}
              {longMonthKey(view.months[0]?.key ?? '')}. The current month — {longMonthKey(view.currentKey)},
              still in progress — is not shown; the forecast begins with the first complete month.
            </p>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-44 shrink-0 truncate font-medium text-ink-2">{term}</dt>
      <dd className="text-ink-3">{children}</dd>
    </div>
  )
}

/* --------------------------- per-month breakdown --------------------------- */

const MAX_STEADY_ROWS = 5
const MAX_VARIABLE_NAMES = 3

/** Month chips (persistent selection, real controls) + the component list for
 * the shown month. `probe` — the chart's transient hover/keyboard position —
 * previews without moving the selection, per the hover-vs-selection rule. */
export function MonthBreakdown({
  view,
  forecast,
  selected,
  probe,
  onSelect,
}: {
  view: ForecastView
  forecast: SpendingForecast
  selected: number
  probe: number | null
  onSelect: (i: number) => void
}) {
  const shown = Math.max(0, Math.min(view.months.length - 1, probe ?? selected))
  const m = view.months[shown]

  const steadyShown = view.steady.slice(0, MAX_STEADY_ROWS)
  const steadyRest = view.steady.slice(MAX_STEADY_ROWS)
  const steadyRestSum = round2(steadyRest.reduce((s, c) => s + c.monthly_equivalent, 0))
  const topVariable = forecast.variable_by_category.slice(0, MAX_VARIABLE_NAMES)
  const variableRest = forecast.variable_by_category.length - topVariable.length

  if (!m) return null

  return (
    <div className="border-t border-edge px-5 pt-3 pb-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Month by month</h4>
        <div
          role="radiogroup"
          aria-label="Breakdown month"
          className="flex flex-wrap rounded-(--radius-s) border border-edge bg-surface-3 p-0.5"
        >
          {view.months.map((mo, i) => (
            <button
              key={mo.key}
              type="button"
              role="radio"
              aria-checked={selected === i}
              onClick={() => onSelect(i)}
              className={`rounded-[calc(var(--radius-s)-2px)] px-2 py-1 text-[11px] font-medium transition-colors duration-150 ${
                shown === i ? 'bg-surface text-ink shadow-1' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {shortMonthKey(mo.key)}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label={`Components for ${longMonthKey(m.key)}`}>
        <p className="text-[13px] font-medium text-ink">
          {longMonthKey(m.key)} — <span className="num">{formatMoney(m.total)}</span>{' '}
          <span className="font-normal text-ink-3">projected</span>
        </p>
        <ul className="mt-1.5 flex flex-col text-[12px]">
          {m.annuals.map((c) => (
            <li key={c.payee} className="flex items-baseline gap-2 border-b border-(--border) py-1.5">
              <span
                className="inline-block size-2 shrink-0 self-center rounded-[2px]"
                style={{ background: 'var(--chart-1)' }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-ink">
                {c.payee} <span className="text-ink-3">— annual charge lands this month</span>
              </span>
              <span className="num shrink-0 font-medium text-ink">
                {formatMoney(c.last_amount, { cents: true })}
              </span>
            </li>
          ))}
          {steadyShown.map((c) => (
            <li key={c.payee} className="flex items-baseline gap-2 border-b border-(--border) py-1.5">
              <span
                className="inline-block size-2 shrink-0 self-center rounded-[2px]"
                style={{ background: 'var(--chart-1)' }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-ink-2">
                {c.payee} <span className="text-ink-3">({CADENCE_LABEL[c.cadence]})</span>
              </span>
              <span className="num shrink-0 text-ink-2">
                {formatMoney(c.monthly_equivalent, { cents: true })}
                <span className="text-ink-3">/mo</span>
              </span>
            </li>
          ))}
          {steadyRest.length > 0 ? (
            <li className="flex items-baseline gap-2 border-b border-(--border) py-1.5 text-ink-3">
              <span className="inline-block size-2 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                + {steadyRest.length} more recurring {steadyRest.length === 1 ? 'charge' : 'charges'}
              </span>
              <span className="num shrink-0">
                {formatMoney(steadyRestSum)}
                <span>/mo</span>
              </span>
            </li>
          ) : null}
          <li className="flex items-baseline gap-2 py-1.5">
            <span
              className="inline-block size-2 shrink-0 self-center rounded-[2px]"
              style={{ background: 'var(--chart-2)' }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-ink-2">
              Variable{' '}
              <span className="text-ink-3">
                ({topVariable.map((c) => c.category).join(', ')}
                {variableRest > 0 ? ` + ${variableRest} more` : ''})
              </span>
            </span>
            <span className="num shrink-0 text-ink-2">
              {formatMoney(m.variableTotal)}
              <span className="text-ink-3">/mo avg</span>
            </span>
          </li>
        </ul>
        <p className="num mt-1 border-t border-edge pt-1.5 text-right text-[12px] text-ink-2">
          {formatMoney(m.recurringTotal)} recurring + {formatMoney(m.variableTotal)} variable ={' '}
          <span className="font-semibold text-ink">{formatMoney(m.total)}</span>
        </p>
      </div>
    </div>
  )
}

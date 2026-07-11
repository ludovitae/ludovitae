/** T-011b assumptions strip — quiet, collapsible chart chrome that states the
 * model's knobs and known limits (PM finding 4: the fan chart was honest
 * about market risk and silent about model risk).
 *
 * Every value comes from the /simulate response's `assumptions` block —
 * never hardcoded — so the strip always describes the run on screen,
 * scenario overrides included. Ink-3 tones by design: assumptions are
 * context, not errors. Collapsed by default; expanded state persists per
 * session. */

import { useState } from 'react'
import type { SimAssumptions } from '@/api/types'
import { IconChevronRight } from '@/components/icons'

const EXPAND_KEY = 'gol.assumptionsStrip.expanded'

/** 7.000000001 → "7%", 3.5 → "3.5%" — one decimal max, no trailing zeros. */
function pct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n * 10) / 10}%`
}

export function AssumptionsStrip({
  assumptions,
  note,
}: {
  assumptions: SimAssumptions
  /** compare mode: shown when pinned scenarios run on differing assumptions */
  note?: string
}) {
  const [expanded, setExpanded] = useState(() => sessionStorage.getItem(EXPAND_KEY) === '1')
  const toggle = () =>
    setExpanded((v) => {
      sessionStorage.setItem(EXPAND_KEY, v ? '0' : '1')
      return !v
    })

  const m = assumptions.market
  const tax = pct(assumptions.effective_tax_rate_pct)
  const ssShare = pct(assumptions.ss_taxable_share * 100)
  const summary = [
    `stocks ${pct(m.stocks_mean_pct)}±${pct(m.stocks_vol_pct)}`,
    `bonds ${pct(m.bonds_mean_pct)}±${pct(m.bonds_vol_pct)}`,
    `inflation ${pct(assumptions.inflation_pct)}`,
    `flat ${tax} tax`,
    `${ssShare} of SS taxable`,
    `engine v${assumptions.engine_version}`,
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
        <span className="truncate">
          Assumes: {summary}
          {note ? ` · ${note}` : ''}
        </span>
      </button>
      {expanded ? (
        <div className="px-5 pt-1 pb-4">
          <dl className="flex flex-col gap-2 text-xs leading-relaxed">
            <Row term={`Stocks ${pct(m.stocks_mean_pct)} ± ${pct(m.stocks_vol_pct)}`}>
              Each simulated year draws a stock return around this average with this much
              year-to-year swing — the main source of the fan&rsquo;s spread.
            </Row>
            <Row term={`Bonds ${pct(m.bonds_mean_pct)} ± ${pct(m.bonds_vol_pct)}`}>
              Same idea for bond holdings: steadier, lower average growth.
            </Row>
            <Row term={`Cash ${pct(m.cash_mean_pct)} ± ${pct(m.cash_vol_pct)}`}>
              Cash and equivalents barely move — over decades they mostly lose ground to
              inflation.
            </Row>
            <Row term={`Inflation ${pct(assumptions.inflation_pct)}`}>
              Spending, Social Security, and future dollars all grow at this single fixed rate in
              every path.
            </Row>
            <Row term={`Flat ${tax} tax`}>
              One flat rate stands in for the whole tax code — flat tax = approximate dollar
              impacts for claim-age/RMD decisions.
            </Row>
            <Row term={`${ssShare} of SS taxable`}>
              At most {ssShare} of Social Security counts as taxable income — the legal ceiling,
              without the income-based phase-in.
            </Row>
            <Row term={`Engine v${assumptions.engine_version}`}>
              The simulation model&rsquo;s behavior version — when it changes, a note by the chart
              says what moved.
            </Row>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            The shaded bands show market luck around these assumptions. They don&rsquo;t show
            model risk — the chance the assumptions themselves are off.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="num w-44 shrink-0 font-medium text-ink-2">{term}</dt>
      <dd className="text-ink-3">{children}</dd>
    </div>
  )
}

/** Category × month spending heatmap (Spending → Summary).
 * Dataviz form choice: magnitude on a grid → sequential, ONE hue — cells are
 * a --chart-1 wash whose opacity scales with value (monotone lightness over
 * both mode surfaces by construction, so light/dark both validate). Identity
 * comes from the labeled rows, never from color. 2px surface gaps separate
 * cells; a row-total column + per-cell tooltips/aria-labels carry exact
 * values (contrast relief for pale low-value cells). Roving tab index gives
 * full keyboard access; the tooltip mirrors hover on focus. */

import { useMemo, useRef, useState } from 'react'
import { formatMoney, formatMoneyCompact } from '@/lib/format'

export interface HeatmapRow {
  category: string
  totals: number[]
  total: number
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(key: string): string {
  const m = MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? key
  return m
}

/** Opacity ramp: 0 → barely-there; sqrt eases mid-range values up so the
 * grid doesn't read as one dark column per big month. */
function alphaFor(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0.045
  return 0.12 + 0.78 * Math.sqrt(v / max)
}

export function CategoryHeatmap({
  months,
  rows,
  maxRows = 12,
}: {
  months: string[]
  rows: HeatmapRow[]
  maxRows?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHoverState] = useState<{ r: number; c: number; x: number; y: number } | null>(null)
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 })

  /** Anchor the tooltip to the hovered cell's real geometry. */
  function setHover(rc: { r: number; c: number } | null, el?: HTMLElement) {
    if (!rc || !el || !wrapRef.current) {
      setHoverState(null)
      return
    }
    const wrap = wrapRef.current.getBoundingClientRect()
    const cell = el.getBoundingClientRect()
    setHoverState({
      ...rc,
      x: cell.left - wrap.left + cell.width / 2,
      y: cell.top - wrap.top,
    })
  }

  const folded = useMemo(() => {
    if (rows.length <= maxRows) return rows
    const kept = rows.slice(0, maxRows - 1)
    const rest = rows.slice(maxRows - 1)
    const totals = months.map((_, i) => rest.reduce((s, r) => s + (r.totals[i] ?? 0), 0))
    return [
      ...kept,
      { category: 'Other', totals, total: rest.reduce((s, r) => s + r.total, 0) },
    ]
  }, [rows, months, maxRows])

  const max = useMemo(
    () => Math.max(1, ...folded.flatMap((r) => r.totals)),
    [folded],
  )

  if (months.length === 0 || folded.length === 0) return null

  const active = hover ?? null
  const activeRow = active ? folded[active.r] : null
  const labelEvery = months.length > 8 ? 2 : 1

  function moveFocus(e: React.KeyboardEvent, r: number, c: number) {
    const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dr && !dc) return
    e.preventDefault()
    const nr = Math.max(0, Math.min(folded.length - 1, r + dr))
    const nc = Math.max(0, Math.min(months.length - 1, c + dc))
    setFocus({ r: nr, c: nc })
    document.getElementById(cellId(nr, nc))?.focus()
  }

  return (
    <div className="relative" ref={wrapRef}>
      <div
        className="grid items-center gap-x-2"
        style={{ gridTemplateColumns: `minmax(6rem, 9rem) 1fr auto` }}
        role="grid"
        aria-label="Spending by category and month"
        aria-rowcount={folded.length}
      >
        {/* header */}
        <span aria-hidden />
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }} aria-hidden>
          {months.map((m, i) => (
            <span key={m} className="pb-1 text-center text-[10px] text-ink-3">
              {i % labelEvery === 0 ? monthLabel(m) : ''}
            </span>
          ))}
        </div>
        <span className="pb-1 text-right text-[10px] text-ink-3" aria-hidden>
          Total
        </span>

        {folded.map((row, r) => (
          <RowCells
            key={row.category}
            row={row}
            r={r}
            months={months}
            max={max}
            focus={focus}
            onHover={setHover}
            onFocusCell={(rc, el) => {
              setFocus(rc)
              setHover(rc, el)
            }}
            onKeyNav={moveFocus}
          />
        ))}
      </div>

      {/* scale legend: one hue, less → more */}
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-ink-3" aria-hidden>
        <span>less</span>
        {[0.08, 0.3, 0.55, 0.9].map((a) => (
          <span
            key={a}
            className="inline-block size-2.5 rounded-[3px]"
            style={{ background: 'var(--chart-1)', opacity: a }}
          />
        ))}
        <span>more · max {formatMoneyCompact(max)}/mo</span>
      </div>

      {active && activeRow ? (
        <div
          className="pointer-events-none absolute z-10 rounded-(--radius-s) border border-edge bg-surface/95 px-3 py-2 shadow-2 backdrop-blur-sm"
          style={{
            left: active.x,
            top: active.y,
            transform:
              active.c / months.length > 0.55
                ? 'translate(calc(-100% - 10px), -50%)'
                : 'translate(10px, -50%)',
          }}
        >
          <p className="text-[11px] text-ink-3">
            {monthLabel(months[active.c]!)} {months[active.c]!.slice(0, 4)} · {activeRow.category}
          </p>
          <p className="num text-sm font-semibold text-ink">
            {formatMoney(activeRow.totals[active.c] ?? 0, { cents: false })}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function cellId(r: number, c: number) {
  return `heat-cell-${r}-${c}`
}

function RowCells({
  row,
  r,
  months,
  max,
  focus,
  onHover,
  onFocusCell,
  onKeyNav,
}: {
  row: HeatmapRow
  r: number
  months: string[]
  max: number
  focus: { r: number; c: number }
  onHover: (v: { r: number; c: number } | null, el?: HTMLElement) => void
  onFocusCell: (v: { r: number; c: number }, el: HTMLElement) => void
  onKeyNav: (e: React.KeyboardEvent, r: number, c: number) => void
}) {
  return (
    <>
      <span className="truncate py-px text-[12px] text-ink-2 capitalize" role="rowheader">
        {row.category}
      </span>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}
        role="row"
        onPointerLeave={() => onHover(null)}
      >
        {row.totals.map((v, c) => (
          <button
            key={c}
            type="button"
            id={cellId(r, c)}
            role="gridcell"
            tabIndex={focus.r === r && focus.c === c ? 0 : -1}
            aria-label={`${row.category}, ${monthLabel(months[c]!)} ${months[c]!.slice(0, 4)}: ${formatMoney(v)}`}
            onPointerEnter={(e) => onHover({ r, c }, e.currentTarget)}
            onFocus={(e) => onFocusCell({ r, c }, e.currentTarget)}
            onBlur={() => onHover(null)}
            onKeyDown={(e) => onKeyNav(e, r, c)}
            className="relative h-6 rounded-[3px] outline-offset-1 focus-visible:outline-2 focus-visible:outline-(--focus)"
          >
            <span
              aria-hidden
              className="absolute inset-0 rounded-[3px]"
              style={{ background: 'var(--chart-1)', opacity: alphaFor(v, max) }}
            />
          </button>
        ))}
      </div>
      <span className="num py-px text-right text-[12px] font-medium text-ink">
        {formatMoneyCompact(row.total)}
      </span>
    </>
  )
}

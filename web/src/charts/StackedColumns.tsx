/** Two-series stacked columns (Spending → Forecast). Dataviz-validated pair
 * (slots 1+2, both modes; light-mode slot-2 contrast WARN is relieved by the
 * y-axis ticks + the visible per-series stat line the tab renders under the
 * legend, plus the column tooltip). Marks per spec: ≤24px columns, square at
 * the baseline, 4px rounded top on the stack's top segment only, 2px surface
 * gap between segments. Whole-column hit targets; tooltip lists every series
 * plus the total; keyboard mirrors hover; tween/draw-in respect reduced
 * motion via the shared helpers. */

import { useCallback, useMemo, useRef, useState } from 'react'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { linScale, niceTicks } from './scale'
import { useContainerWidth } from './useContainerWidth'
import { useMountProgress, useTweenedMatrix } from './useTween'

const M = { top: 10, right: 12, bottom: 24, left: 56 }
const GAP = 2 // surface gap between stacked segments

export interface StackSeries {
  name: string
  color: string
  values: number[]
}

export function StackedColumns({
  labels,
  series,
  height = 240,
  ariaLabel,
  formatLabel = (l: string) => l,
  onProbeChange,
  onSelect,
}: {
  labels: string[]
  /** bottom-to-top stack order */
  series: StackSeries[]
  height?: number
  ariaLabel: string
  formatLabel?: (label: string) => string
  /** transient hover/keyboard probe position (null when the probe leaves) */
  onProbeChange?: (index: number | null) => void
  /** Enter/Space on a probed column — persistent selection */
  onSelect?: (index: number) => void
}) {
  const [wrapRef, width] = useContainerWidth<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const [probe, setProbeState] = useState<number | null>(null)
  const probeSent = useRef<number | null>(null)
  const setProbe = useCallback(
    (i: number | null) => {
      setProbeState(i)
      if (probeSent.current !== i) {
        probeSent.current = i
        onProbeChange?.(i)
      }
    },
    [onProbeChange],
  )

  const matrix = useTweenedMatrix(
    useMemo(() => series.map((s) => s.values), [series]),
    300,
  )
  const mount = useMountProgress(400)

  const n = labels.length
  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = Math.max(0, height - M.top - M.bottom)

  const totals = useMemo(
    () => labels.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] ?? 0), 0)),
    [labels, series],
  )
  const yMax = Math.max(1, ...totals) * 1.08

  const idxFromClientX = useCallback(
    (clientX: number) => {
      if (!svgRef.current || n === 0) return null
      const rect = svgRef.current.getBoundingClientRect()
      const t = (clientX - rect.left - M.left) / Math.max(1, innerW)
      return Math.max(0, Math.min(n - 1, Math.floor(t * n)))
    },
    [innerW, n],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (n === 0) return
      const cur = probe ?? n - 1
      if (e.key === 'ArrowRight') setProbe(Math.min(n - 1, cur + 1))
      else if (e.key === 'ArrowLeft') setProbe(Math.max(0, cur - 1))
      else if (e.key === 'Escape') setProbe(null)
      else if ((e.key === 'Enter' || e.key === ' ') && probe !== null) onSelect?.(probe)
      else return
      e.preventDefault()
    },
    [probe, n, setProbe, onSelect],
  )

  if (width === 0 || n === 0) return <div ref={wrapRef} style={{ height }} aria-hidden />

  const y = linScale(0, yMax, M.top + innerH, M.top)
  const band = innerW / n
  const colW = Math.min(24, Math.max(6, band * 0.55))
  const yTicks = niceTicks(0, yMax, 4)
  const labelStep = Math.max(1, Math.ceil(n / 8))

  return (
    <div
      ref={wrapRef}
      className="relative select-none focus:outline-none"
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onBlur={() => setProbe(null)}
    >
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={(e) => setProbe(idxFromClientX(e.clientX))}
        onPointerLeave={() => setProbe(null)}
        onClick={(e) => {
          const i = idxFromClientX(e.clientX)
          if (i !== null) onSelect?.(i)
        }}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num" fill="var(--ink-3)" fontSize="11">
              {formatMoneyCompact(t)}
            </text>
          </g>
        ))}

        {labels.map((label, i) => {
          const cx = M.left + band * (i + 0.5)
          const x = cx - colW / 2
          let yCursor = M.top + innerH // baseline
          const dim = probe !== null && probe !== i
          return (
            <g key={label} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 120ms' }}>
              {matrix.map((vals, s) => {
                const v = Math.max(0, (vals[i] ?? 0) * mount)
                const segH = Math.max(0, M.top + innerH - y(v))
                const top = yCursor - segH
                const isTop = s === matrix.length - 1
                // Interior boundaries get a 2px surface gap: every non-top
                // segment shaves GAP off its own top edge.
                const el =
                  segH <= 0.5 ? null : isTop ? (
                    <path key={s} d={roundedTopRect(x, top, colW, segH, 4)} fill={series[s]!.color} />
                  ) : (
                    <rect key={s} x={x} y={top + GAP} width={colW} height={Math.max(1, segH - GAP)} fill={series[s]!.color} />
                  )
                yCursor = top
                return el
              })}
              {i % labelStep === 0 ? (
                <text x={cx} y={M.top + innerH + 16} textAnchor="middle" fill="var(--ink-3)" fontSize="10">
                  {formatLabel(label)}
                </text>
              ) : null}
            </g>
          )
        })}

        {probe !== null ? (
          <line
            x1={M.left + band * (probe + 0.5)}
            x2={M.left + band * (probe + 0.5)}
            y1={M.top}
            y2={M.top + innerH}
            stroke="var(--chart-axis)"
            strokeWidth="1"
          />
        ) : null}
      </svg>

      {probe !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-(--radius-s) border border-edge bg-surface/95 px-3 py-2 shadow-2 backdrop-blur-sm"
          style={{
            left: M.left + band * (probe + 0.5),
            transform: (probe + 0.5) / n > 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
          }}
        >
          <p className="text-[11px] text-ink-3">{formatLabel(labels[probe]!)}</p>
          {[...series].reverse().map((s) => (
            <p key={s.name} className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              <span className="num font-semibold text-ink">{formatMoney(s.values[probe] ?? 0)}</span>
              <span>{s.name}</span>
            </p>
          ))}
          <p className="num mt-0.5 border-t border-edge pt-0.5 text-[12px] font-semibold text-ink">
            {formatMoney(totals[probe] ?? 0)} <span className="font-normal text-ink-3">total</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** Rect with rounded top corners, square baseline — the stack's data end. */
function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

/** Net-worth projection fan chart — hand-rolled SVG per the dataviz skill.
 * Layered p10–p90 / p25–p75 bands, p50 line, dashed deterministic reference,
 * crosshair probe (pointer + keyboard), draw-in on mount, tweened data. */

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { bandPath, extent, linePath, linScale, niceTicks } from './scale'
import { useContainerWidth } from './useContainerWidth'
import { useMountProgress, useTweenedMatrix } from './useTween'

export interface FanChartSeries {
  name: string
  /** CSS color (token reference like 'var(--chart-1)') */
  color: string
  percentiles: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] }
  /** deterministic net-worth reference (single-scenario mode) */
  deterministic?: number[]
  showBands?: boolean
}

const M = { top: 12, right: 20, bottom: 30, left: 56 }
const ROWS_PER_SERIES = 6 // p10 p25 p50 p75 p90 det(pad)

export function FanChart({
  series,
  ages,
  startYear,
  refAge,
  refAgeLabel,
  height = 320,
  ariaLabel = 'Projected net worth fan chart',
}: {
  series: FanChartSeries[]
  ages: number[]
  startYear: number
  /** vertical annotation, e.g. retirement age */
  refAge?: number
  refAgeLabel?: string
  height?: number
  ariaLabel?: string
}) {
  const [wrapRef, width] = useContainerWidth<HTMLDivElement>()
  const [probe, setProbe] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const clipId = useId()

  // ---- tween all series rows as one matrix (fixed row layout per series)
  const targetMatrix = useMemo(() => {
    const rows: number[][] = []
    for (const s of series) {
      rows.push(s.percentiles.p10, s.percentiles.p25, s.percentiles.p50, s.percentiles.p75, s.percentiles.p90)
      rows.push(s.deterministic ?? s.percentiles.p50)
    }
    return rows
  }, [series])
  const matrix = useTweenedMatrix(targetMatrix, 300)
  const mount = useMountProgress(400)

  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = Math.max(0, height - M.top - M.bottom)
  const n = ages.length

  const geom = useMemo(() => {
    if (width === 0 || n === 0 || matrix.length === 0) return null
    const visible: number[][] = []
    series.forEach((s, i) => {
      const base = i * ROWS_PER_SERIES
      if (s.showBands !== false) visible.push(matrix[base]!, matrix[base + 4]!)
      visible.push(matrix[base + 2]!)
      if (s.deterministic) visible.push(matrix[base + 5]!)
    })
    const [yMin, yMax] = extent(visible)
    const x = linScale(ages[0]!, ages[n - 1]!, M.left, M.left + innerW)
    const y = linScale(yMin, yMax, M.top + innerH, M.top)
    const xs = ages.map((a) => x(a))
    return { x, y, xs, yMin, yMax }
  }, [width, n, matrix, series, ages, innerW, innerH])

  const idxFromClientX = useCallback(
    (clientX: number) => {
      if (!svgRef.current || !geom || n < 2) return null
      const rect = svgRef.current.getBoundingClientRect()
      const px = clientX - rect.left
      const t = (px - M.left) / Math.max(1, innerW)
      return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))
    },
    [geom, innerW, n],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (n === 0) return
      const cur = probe ?? Math.floor(n / 2)
      let next: number | null = null
      if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
      else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = n - 1
      else if (e.key === 'Escape') {
        setProbe(null)
        return
      } else return
      e.preventDefault()
      setProbe(next)
    },
    [probe, n],
  )

  if (!geom) {
    return <div ref={wrapRef} style={{ height }} aria-hidden />
  }

  const { y, xs, yMin, yMax } = geom
  const yTicks = niceTicks(yMin, yMax, 5)
  const xTickAges = niceTicks(ages[0]!, ages[n - 1]!, 6).filter(
    (a) => Number.isInteger(a) && a >= ages[0]! && a <= ages[n - 1]!,
  )
  const clipW = M.left + innerW * mount + 1

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
      {series.length >= 2 ? (
        <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 pl-[56px]">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}

      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={(e) => setProbe(idxFromClientX(e.clientX))}
        onPointerLeave={() => setProbe(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={clipW} height={height} />
          </clipPath>
        </defs>

        {/* grid + y axis */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
              strokeWidth="1"
            />
            <text
              x={M.left - 8}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="num"
              fill="var(--ink-3)"
              fontSize="11"
            >
              {formatMoneyCompact(t)}
            </text>
          </g>
        ))}

        {/* x axis */}
        <line
          x1={M.left}
          x2={M.left + innerW}
          y1={M.top + innerH}
          y2={M.top + innerH}
          stroke="var(--chart-axis)"
          strokeWidth="1"
        />
        {xTickAges.map((a) => (
          <text
            key={a}
            x={geom.x(a)}
            y={M.top + innerH + 18}
            textAnchor="middle"
            className="num"
            fill="var(--ink-3)"
            fontSize="11"
          >
            {a}
          </text>
        ))}
        <text
          x={M.left + innerW}
          y={height - 2}
          textAnchor="end"
          fill="var(--ink-3)"
          fontSize="10"
        >
          age
        </text>

        {/* reference age annotation */}
        {refAge !== undefined && refAge >= ages[0]! && refAge <= ages[n - 1]! ? (
          <g>
            <line
              x1={geom.x(refAge)}
              x2={geom.x(refAge)}
              y1={M.top}
              y2={M.top + innerH}
              stroke="var(--chart-axis)"
              strokeWidth="1"
            />
            <text
              x={geom.x(refAge) + 5}
              y={M.top + 10}
              fill="var(--ink-3)"
              fontSize="10"
            >
              {refAgeLabel ?? `retire ${refAge}`}
            </text>
          </g>
        ) : null}

        {/* series */}
        <g clipPath={`url(#${clipId})`}>
          {series.map((s, i) => {
            const base = i * ROWS_PER_SERIES
            const p10 = matrix[base]!
            const p25 = matrix[base + 1]!
            const p50 = matrix[base + 2]!
            const p75 = matrix[base + 3]!
            const p90 = matrix[base + 4]!
            const det = matrix[base + 5]!
            const toY = (row: number[]) => row.map((v) => y(v))
            return (
              <g key={s.name}>
                {s.showBands !== false ? (
                  <>
                    <path d={bandPath(xs, toY(p90), toY(p10))} fill={s.color} opacity="0.10" />
                    <path d={bandPath(xs, toY(p75), toY(p25))} fill={s.color} opacity="0.16" />
                  </>
                ) : null}
                {s.deterministic ? (
                  <path
                    d={linePath(xs, toY(det))}
                    fill="none"
                    stroke="var(--chart-ref)"
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                    strokeLinecap="round"
                  />
                ) : null}
                <path
                  d={linePath(xs, toY(p50))}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )
          })}
        </g>

        {/* probe crosshair */}
        {probe !== null ? (
          <g>
            <line
              x1={xs[probe]}
              x2={xs[probe]}
              y1={M.top}
              y2={M.top + innerH}
              stroke="var(--chart-axis)"
              strokeWidth="1"
            />
            {series.map((s, i) => (
              <circle
                key={s.name}
                cx={xs[probe]}
                cy={y(matrix[i * ROWS_PER_SERIES + 2]![probe]!)}
                r="4"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            ))}
          </g>
        ) : null}
      </svg>

      {probe !== null ? (
        <ProbeTooltip
          series={series}
          matrix={matrix}
          idx={probe}
          age={ages[probe]!}
          year={startYear + probe}
          leftPx={xs[probe]!}
          flip={(xs[probe]! - M.left) / Math.max(1, innerW) > 0.55}
        />
      ) : null}
    </div>
  )
}

function ProbeTooltip({
  series,
  matrix,
  idx,
  age,
  year,
  leftPx,
  flip,
}: {
  series: FanChartSeries[]
  matrix: number[][]
  idx: number
  age: number
  year: number
  leftPx: number
  flip: boolean
}) {
  const single = series.length === 1
  const rows: { key: string; label: string; value: number; color?: string; strong?: boolean; dashed?: boolean }[] = []
  if (single) {
    const s = series[0]!
    rows.push(
      { key: 'p90', label: '90th', value: matrix[4]![idx]!, color: s.color },
      { key: 'p75', label: '75th', value: matrix[3]![idx]!, color: s.color },
      { key: 'p50', label: 'Median', value: matrix[2]![idx]!, color: s.color, strong: true },
      { key: 'p25', label: '25th', value: matrix[1]![idx]!, color: s.color },
      { key: 'p10', label: '10th', value: matrix[0]![idx]!, color: s.color },
    )
    if (s.deterministic) rows.push({ key: 'det', label: 'Expected', value: matrix[5]![idx]!, dashed: true })
  } else {
    series.forEach((s, i) => {
      rows.push({ key: s.name, label: s.name, value: matrix[i * ROWS_PER_SERIES + 2]![idx]!, color: s.color, strong: true })
    })
  }
  return (
    <div
      className="pointer-events-none absolute top-3 z-10 min-w-44 rounded-(--radius-s) border border-edge bg-surface/95 px-3 py-2.5 shadow-2 backdrop-blur-sm"
      style={{
        left: leftPx,
        transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
      }}
    >
      <p className="mb-1.5 text-[11px] font-medium text-ink-3">
        Age {age} · {year}
      </p>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
              <span
                className="inline-block h-0.5 w-3 rounded-full"
                style={{
                  background: r.dashed
                    ? 'repeating-linear-gradient(90deg, var(--chart-ref) 0 3px, transparent 3px 5px)'
                    : (r.color ?? 'var(--chart-ref)'),
                  opacity: r.strong || r.dashed ? 1 : 0.55,
                }}
              />
              {r.label}
            </span>
            <span className={`num text-xs ${r.strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>
              {formatMoney(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

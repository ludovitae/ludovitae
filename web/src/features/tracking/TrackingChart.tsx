/** Plan-vs-actuals overlay (v1.3, #21). A focused near-term window: the frozen
 * plan line (dashed reference) resampled onto the actual line's dates, the
 * p25-p75 "normal range" as a translucent ribbon (net_worth only), and the
 * actual line emphasized. Built from the shared scale.ts primitives, same
 * crosshair-probe idiom as AreaChart. Two series -> a legend is always shown. */

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { PlanTracking, TrackingMetric, TrackingPoint } from '@/api/types'
import { formatMoney, formatMoneyCompact, formatMonthYear } from '@/lib/format'
import { bandPath, extent, linePath, linScale, niceTicks } from '@/charts/scale'
import { useContainerWidth } from '@/charts/useContainerWidth'
import { useMountProgress } from '@/charts/useTween'

const M = { top: 12, right: 16, bottom: 24, left: 60 }
const PLAN_COLOR = 'var(--chart-2)'
const ACTUAL_COLOR = 'var(--chart-1)'

/** Linear interpolation of a dated series at an ISO target (flat outside). */
function interp(series: TrackingPoint[], targetISO: string): number | null {
  if (series.length === 0) return null
  const pts = series
    .map((p) => [p.date, p.value] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const last = pts[pts.length - 1]!
  if (targetISO <= pts[0]![0]) return pts[0]![1]
  if (targetISO >= last[0]) return last[1]
  for (let i = 1; i < pts.length; i++) {
    if (targetISO <= pts[i]![0]) {
      const [d0, v0] = pts[i - 1]!
      const [d1, v1] = pts[i]!
      const span = Date.parse(d1) - Date.parse(d0) || 1
      return v0 + (v1 - v0) * ((Date.parse(targetISO) - Date.parse(d0)) / span)
    }
  }
  return last[1]
}

export function TrackingChart({
  tracking,
  metric,
  height = 260,
}: {
  tracking: PlanTracking
  metric: TrackingMetric
  height?: number
}) {
  const [wrapRef, width] = useContainerWidth<HTMLDivElement>()
  const [probe, setProbe] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const clipId = useId()
  const mount = useMountProgress(400)

  // Shared grid = the actual line's dates; plan + band resampled onto them.
  const grid = useMemo(() => {
    const dates = tracking.actual.map((p) => p.date)
    const actual = tracking.actual.map((p) => p.value)
    const plan = dates.map((d) => interp(tracking.plan, d) ?? 0)
    const lo = tracking.band ? dates.map((d) => interp(tracking.band!.p25, d) ?? 0) : null
    const hi = tracking.band ? dates.map((d) => interp(tracking.band!.p75, d) ?? 0) : null
    return { dates, actual, plan, lo, hi }
  }, [tracking])

  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = Math.max(0, height - M.top - M.bottom)
  const n = grid.dates.length

  const geom = useMemo(() => {
    if (width === 0 || n < 2) return null
    const bands: number[][] = [grid.actual, grid.plan]
    if (grid.lo && grid.hi) bands.push(grid.lo, grid.hi)
    const [yMin, yMax] = extent(bands, 0.1)
    const x = linScale(0, n - 1, M.left, M.left + innerW)
    const y = linScale(yMin, yMax, M.top + innerH, M.top)
    const xs = grid.dates.map((_, i) => x(i))
    return {
      x,
      y,
      xs,
      yMin,
      yMax,
      actualYs: grid.actual.map((v) => y(v)),
      planYs: grid.plan.map((v) => y(v)),
      loYs: grid.lo?.map((v) => y(v)) ?? null,
      hiYs: grid.hi?.map((v) => y(v)) ?? null,
    }
  }, [width, n, grid, innerW, innerH])

  const idxFromClientX = useCallback(
    (clientX: number) => {
      if (!svgRef.current || n < 2) return null
      const rect = svgRef.current.getBoundingClientRect()
      const t = (clientX - rect.left - M.left) / Math.max(1, innerW)
      return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))
    },
    [innerW, n],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (n === 0) return
      const cur = probe ?? n - 1
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setProbe(Math.min(n - 1, cur + 1))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setProbe(Math.max(0, cur - 1))
      } else if (e.key === 'Escape') setProbe(null)
    },
    [probe, n],
  )

  if (!geom) return <div ref={wrapRef} style={{ height }} aria-hidden />

  const { xs, actualYs, planYs, loYs, hiYs, y, yMin, yMax } = geom
  const yTicks = niceTicks(yMin, yMax, 4)
  const step = Math.max(1, Math.round(n / 5))
  const xTickIdx: number[] = []
  for (let i = 0; i < n; i += step) xTickIdx.push(i)
  if (xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1)

  const money = (v: number) => formatMoney(v)
  const unit = metric === 'net_worth' ? '' : '/mo'

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative select-none focus:outline-none"
        tabIndex={0}
        role="img"
        aria-label={`${metric.replace('_', ' ')} plan versus actual`}
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
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={M.left + innerW * mount + 1} height={height} />
            </clipPath>
          </defs>

          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={M.left}
                x2={M.left + innerW}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--chart-grid)"
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
          {xTickIdx.map((i) => (
            <text
              key={i}
              x={xs[i]}
              y={M.top + innerH + 16}
              textAnchor="middle"
              fill="var(--ink-3)"
              fontSize="10"
            >
              {formatMonthYear(grid.dates[i]!)}
            </text>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {loYs && hiYs ? (
              <path d={bandPath(xs, hiYs, loYs)} fill={PLAN_COLOR} opacity="0.13" />
            ) : null}
            <path
              d={linePath(xs, planYs)}
              fill="none"
              stroke={PLAN_COLOR}
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
            <path
              d={linePath(xs, actualYs)}
              fill="none"
              stroke={ACTUAL_COLOR}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

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
              <circle cx={xs[probe]} cy={planYs[probe]} r="3.5" fill={PLAN_COLOR} stroke="var(--surface)" strokeWidth="2" />
              <circle cx={xs[probe]} cy={actualYs[probe]} r="4" fill={ACTUAL_COLOR} stroke="var(--surface)" strokeWidth="2" />
            </g>
          ) : null}
        </svg>

        {probe !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-(--radius-s) border border-edge bg-surface/95 px-3 py-2 shadow-2 backdrop-blur-sm"
            style={{
              left: xs[probe],
              transform:
                (xs[probe]! - M.left) / Math.max(1, innerW) > 0.6
                  ? 'translateX(calc(-100% - 10px))'
                  : 'translateX(10px)',
            }}
          >
            <p className="text-[11px] text-ink-3">{formatMonthYear(grid.dates[probe]!)}</p>
            <p className="num text-sm font-semibold text-ink">
              {money(grid.actual[probe]!)}
              {unit} <span className="text-ink-3">actual</span>
            </p>
            <p className="num text-xs text-ink-2">
              {money(grid.plan[probe]!)}
              {unit} <span className="text-ink-3">plan</span>
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: ACTUAL_COLOR }} />
          Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-4 border-t-2 border-dashed"
            style={{ borderColor: PLAN_COLOR }}
          />
          Plan
        </span>
        {tracking.band ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{ background: PLAN_COLOR, opacity: 0.13 }}
            />
            Normal range (p25–p75)
          </span>
        ) : null}
      </div>
    </div>
  )
}

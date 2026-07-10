/** Net-worth history area chart from balance snapshots. 2px line, ~12% wash,
 * crosshair probe with date + value, draw-in on mount. */

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { formatMoney, formatMoneyCompact, formatMonthYear } from '@/lib/format'
import { areaPath, extent, linePath, linScale, niceTicks } from './scale'
import { useContainerWidth } from './useContainerWidth'
import { useMountProgress, useTweenedMatrix } from './useTween'

const M = { top: 10, right: 12, bottom: 24, left: 56 }

export function AreaChart({
  points,
  height = 200,
  color = 'var(--chart-1)',
  ariaLabel = 'Net worth history',
}: {
  points: { date: string; value: number }[]
  height?: number
  color?: string
  ariaLabel?: string
}) {
  const [wrapRef, width] = useContainerWidth<HTMLDivElement>()
  const [probe, setProbe] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const clipId = useId()

  const values = useMemo(() => points.map((p) => p.value), [points])
  const matrix = useTweenedMatrix(useMemo(() => [values], [values]), 300)
  const tweened = matrix[0] ?? values
  const mount = useMountProgress(400)

  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = Math.max(0, height - M.top - M.bottom)
  const n = points.length

  const geom = useMemo(() => {
    if (width === 0 || n < 2) return null
    const [yMin, yMax] = extent([tweened], 0.08)
    const lo = Math.min(yMin, yMin - (yMax - yMin) * 0.04)
    const x = linScale(0, n - 1, M.left, M.left + innerW)
    const y = linScale(lo, yMax, M.top + innerH, M.top)
    const xs = points.map((_, i) => x(i))
    const ys = tweened.map((v) => y(v))
    return { x, y, xs, ys, yMin: lo, yMax }
  }, [width, n, tweened, points, innerW, innerH])

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
      let next: number | null = null
      if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
      else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
      else if (e.key === 'Escape') {
        setProbe(null)
        return
      } else return
      e.preventDefault()
      setProbe(next)
    },
    [probe, n],
  )

  if (!geom) return <div ref={wrapRef} style={{ height }} aria-hidden />

  const { xs, ys, y, yMin, yMax } = geom
  const yTicks = niceTicks(yMin, yMax, 4)
  // x labels: ~5 date ticks
  const step = Math.max(1, Math.round(n / 5))
  const xTickIdx: number[] = []
  for (let i = 0; i < n; i += step) xTickIdx.push(i)

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
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={M.left + innerW * mount + 1} height={height} />
          </clipPath>
        </defs>

        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num" fill="var(--ink-3)" fontSize="11">
              {formatMoneyCompact(t)}
            </text>
          </g>
        ))}
        {xTickIdx.map((i) => (
          <text key={i} x={xs[i]} y={M.top + innerH + 16} textAnchor="middle" fill="var(--ink-3)" fontSize="10">
            {formatMonthYear(points[i]!.date)}
          </text>
        ))}

        <g clipPath={`url(#${clipId})`}>
          <path d={areaPath(xs, ys, M.top + innerH)} fill={color} opacity="0.12" />
          <path d={linePath(xs, ys)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {probe !== null ? (
          <g>
            <line x1={xs[probe]} x2={xs[probe]} y1={M.top} y2={M.top + innerH} stroke="var(--chart-axis)" strokeWidth="1" />
            <circle cx={xs[probe]} cy={ys[probe]} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
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
          <p className="text-[11px] text-ink-3">{formatMonthYear(points[probe]!.date)}</p>
          <p className="num text-sm font-semibold text-ink">{formatMoney(points[probe]!.value)}</p>
        </div>
      ) : null}
    </div>
  )
}

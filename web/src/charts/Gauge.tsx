/** Success probability — large stat with a subtle radial treatment
 * (270° arc, rounded caps), animated sweep. Not a toy speedometer. */

import { formatProbability } from '@/lib/format'
import { useTweenedValue } from './useTween'

export function ProbabilityGauge({
  probability,
  label = 'Chance the money lasts',
  size = 132,
}: {
  probability: number
  label?: string
  size?: number
}) {
  const p = useTweenedValue(Math.max(0, Math.min(1, probability)), 450)
  const stroke = 8
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const startDeg = 135
  const sweepDeg = 270

  const polar = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  }
  const arcPath = (deg0: number, deg1: number) => {
    const [x0, y0] = polar(deg0)
    const [x1, y1] = polar(deg1)
    const large = deg1 - deg0 > 180 ? 1 : 0
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
  }

  const fillEnd = startDeg + sweepDeg * p

  return (
    <div className="flex flex-col items-center" role="img" aria-label={`${label}: ${formatProbability(probability)}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path
            d={arcPath(startDeg, startDeg + sweepDeg)}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {p > 0.005 ? (
            <path
              d={arcPath(startDeg, fillEnd)}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="num-display text-3xl font-semibold text-ink">
            {formatProbability(p)}
          </span>
        </div>
      </div>
      <p className="mt-1 text-center text-xs text-ink-3">{label}</p>
    </div>
  )
}

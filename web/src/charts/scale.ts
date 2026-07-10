/** Pure chart math — scales, nice ticks, path builders, resampling.
 * Kept free of React/DOM so it is unit-testable. */

export type Scale = (v: number) => number

export function linScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const dd = d1 - d0
  if (dd === 0) return () => (r0 + r1) / 2
  const k = (r1 - r0) / dd
  return (v: number) => r0 + (v - d0) * k
}

/** Round to a "nice" 1/2/5×10^k step and return ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) {
    const pad = Math.abs(min) || 1
    min -= pad / 2
    max += pad / 2
  }
  const span = max - min
  const rawStep = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) {
    // avoid -0 and float drift
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)))
  }
  return ticks
}

/** Min/max across many series, with a little headroom on top. */
export function extent(series: (readonly number[])[], padRatio = 0.06): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const s of series) {
    for (const v of s) {
      if (!Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (min === Infinity) return [0, 1]
  const pad = (max - min || Math.abs(max) || 1) * padRatio
  return [min < 0 ? min - pad : Math.min(0, min), max + pad]
}

export function linePath(xs: readonly number[], ys: readonly number[]): string {
  let d = ''
  for (let i = 0; i < xs.length; i++) {
    d += `${i === 0 ? 'M' : 'L'}${round2(xs[i]!)},${round2(ys[i]!)}`
  }
  return d
}

/** Closed band between two y-series sharing x positions. */
export function bandPath(
  xs: readonly number[],
  yTop: readonly number[],
  yBottom: readonly number[],
): string {
  if (xs.length === 0) return ''
  let d = linePath(xs, yTop)
  for (let i = xs.length - 1; i >= 0; i--) {
    d += `L${round2(xs[i]!)},${round2(yBottom[i]!)}`
  }
  return d + 'Z'
}

/** Area from a line down to a baseline y. */
export function areaPath(xs: readonly number[], ys: readonly number[], yBase: number): string {
  if (xs.length === 0) return ''
  return (
    linePath(xs, ys) +
    `L${round2(xs[xs.length - 1]!)},${round2(yBase)}L${round2(xs[0]!)},${round2(yBase)}Z`
  )
}

/** Linear resample of a series to n points (for tweening across lengths). */
export function resample(values: readonly number[], n: number): number[] {
  if (values.length === 0) return new Array<number>(n).fill(0)
  if (values.length === n) return [...values]
  if (values.length === 1) return new Array<number>(n).fill(values[0]!)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (values.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(values.length - 1, lo + 1)
    const f = t - lo
    out[i] = values[lo]! * (1 - f) + values[hi]! * f
  }
  return out
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Interpolate two same-length vectors. */
export function lerpVec(a: readonly number[], b: readonly number[], t: number): number[] {
  const out = new Array<number>(b.length)
  for (let i = 0; i < b.length; i++) out[i] = a[i]! * (1 - t) + b[i]! * t
  return out
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

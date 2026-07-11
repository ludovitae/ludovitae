/** rAF tween of a matrix of series toward a target — charts interpolate on
 * data change and never flash empty. Resamples when lengths differ. */

import { useEffect, useRef, useState } from 'react'
import { easeOutCubic, lerpVec, resample } from './scale'
import { useMotionOK } from '@/theme/ThemeProvider'

export function useTweenedMatrix(target: number[][], duration = 300): number[][] {
  const motionOK = useMotionOK()
  const [current, setCurrent] = useState<number[][]>(target)
  const displayed = useRef<number[][]>(target)
  const raf = useRef<number>(0)
  const key = matrixKey(target)

  useEffect(() => {
    const from = displayed.current.map((row, i) =>
      resample(row, target[i]?.length ?? row.length),
    )
    // Row-count changes (e.g. compare add/remove) snap; same-count glides.
    if (!motionOK || from.length !== target.length) {
      displayed.current = target
      setCurrent(target)
      return
    }
    const t0 = performance.now()
    cancelAnimationFrame(raf.current)
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      const eased = easeOutCubic(t)
      const next = target.map((row, i) => lerpVec(from[i]!, row, eased))
      displayed.current = next
      setCurrent(next)
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, motionOK, duration])

  return current
}

function matrixKey(m: number[][]): string {
  // cheap change detection: lengths + endpoints + a middle sample
  let k = ''
  for (const row of m) {
    const mid = row[row.length >> 1]
    k += `${row.length}:${row[0]}:${mid}:${row[row.length - 1]};`
  }
  return k
}

/** Keyed scalar tween — values glide toward their targets per key; keys that
 * appear snap into place, keys that vanish drop immediately. Used for
 * milestone-marker positions so they move smoothly with slider drags.
 * Reduced motion: everything snaps. */
export function useTweenedRecord(
  target: Record<string, number>,
  duration = 300,
): Record<string, number> {
  const motionOK = useMotionOK()
  const [current, setCurrent] = useState<Record<string, number>>(target)
  const displayed = useRef<Record<string, number>>(target)
  const raf = useRef<number>(0)
  const key = Object.entries(target)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(';')

  useEffect(() => {
    const from = displayed.current
    if (!motionOK) {
      displayed.current = target
      setCurrent(target)
      return
    }
    const t0 = performance.now()
    cancelAnimationFrame(raf.current)
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      const eased = easeOutCubic(t)
      const next: Record<string, number> = {}
      for (const [k, v] of Object.entries(target)) {
        const f = from[k]
        next[k] = f === undefined ? v : f + (v - f) * eased
      }
      displayed.current = next
      setCurrent(next)
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, motionOK, duration])

  return current
}

/** Single scalar tween (gauge sweep, hero numbers). */
export function useTweenedValue(target: number, duration = 400): number {
  const [m] = [useTweenedMatrix([[target]], duration)]
  return m[0]?.[0] ?? target
}

/** 0→1 once on mount (draw-in). Returns 1 immediately under reduced motion. */
export function useMountProgress(duration = 400): number {
  const motionOK = useMotionOK()
  const [p, setP] = useState(motionOK ? 0 : 1)
  useEffect(() => {
    if (!motionOK) {
      setP(1)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      setP(easeOutCubic(t))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return p
}

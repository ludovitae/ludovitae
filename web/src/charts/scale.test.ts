import { describe, expect, it } from 'vitest'
import {
  areaPath,
  bandPath,
  extent,
  lerpVec,
  linePath,
  linScale,
  niceTicks,
  resample,
} from './scale'

describe('linScale', () => {
  it('maps domain to range linearly', () => {
    const s = linScale(0, 10, 0, 100)
    expect(s(0)).toBe(0)
    expect(s(5)).toBe(50)
    expect(s(10)).toBe(100)
  })
  it('supports inverted ranges (SVG y)', () => {
    const s = linScale(0, 100, 200, 0)
    expect(s(0)).toBe(200)
    expect(s(100)).toBe(0)
  })
  it('degrades gracefully on zero-width domains', () => {
    const s = linScale(5, 5, 0, 100)
    expect(s(5)).toBe(50)
  })
})

describe('niceTicks', () => {
  it('produces 1/2/5-stepped ticks covering the domain', () => {
    const ticks = niceTicks(0, 1000, 5)
    expect(ticks[0]).toBe(0)
    expect(ticks).toContain(500)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(1000)
  })
  it('includes zero when the domain crosses it', () => {
    expect(niceTicks(-250000, 900000, 5)).toContain(0)
  })
  it('handles degenerate domains', () => {
    expect(niceTicks(5, 5, 5).length).toBeGreaterThan(0)
  })
})

describe('extent', () => {
  it('spans all series with headroom', () => {
    const [lo, hi] = extent([[10, 20], [5, 40]])
    expect(lo).toBeLessThanOrEqual(0) // clamps to zero for positive data
    expect(hi).toBeGreaterThan(40)
  })
  it('pads below when negative values exist', () => {
    const [lo] = extent([[-100, 50]])
    expect(lo).toBeLessThan(-100)
  })
})

describe('paths', () => {
  it('builds a line path', () => {
    expect(linePath([0, 10], [5, 15])).toBe('M0,5L10,15')
  })
  it('closes a band top-forward bottom-back', () => {
    const d = bandPath([0, 10], [1, 2], [8, 9])
    expect(d).toBe('M0,1L10,2L10,9L0,8Z')
  })
  it('drops an area to the baseline', () => {
    const d = areaPath([0, 10], [1, 2], 20)
    expect(d).toBe('M0,1L10,2L10,20L0,20Z')
  })
  it('returns empty for no points', () => {
    expect(bandPath([], [], [])).toBe('')
  })
})

describe('resample', () => {
  it('is identity at matching length', () => {
    expect(resample([1, 2, 3], 3)).toEqual([1, 2, 3])
  })
  it('preserves endpoints and interpolates linearly', () => {
    const out = resample([0, 10], 5)
    expect(out[0]).toBe(0)
    expect(out[4]).toBe(10)
    expect(out[2]).toBeCloseTo(5)
  })
  it('handles down-sampling', () => {
    const out = resample([0, 5, 10, 15, 20], 3)
    expect(out).toEqual([0, 10, 20])
  })
})

describe('lerpVec', () => {
  it('interpolates element-wise', () => {
    expect(lerpVec([0, 10], [10, 20], 0.5)).toEqual([5, 15])
    expect(lerpVec([0], [10], 1)).toEqual([10])
  })
})

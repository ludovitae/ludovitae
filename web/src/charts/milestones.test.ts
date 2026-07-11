import { describe, expect, it } from 'vitest'
import type { Milestone } from '@/api/types'
import { layoutMarkers, toMarkers } from './milestones'
import type { MarkerDatum } from './milestones'

const x = (age: number) => age * 10 // simple linear px scale
const bounds = { minAge: 40, maxAge: 90, minX: 400, maxX: 900 }

function marker(key: string, age: number, shortLabel = 'Brian'): MarkerDatum {
  return { key, age, kind: 'retirement', label: `${shortLabel} retires`, shortLabel }
}

describe('layoutMarkers (milestone positioning transform)', () => {
  it('positions the hairline at the scaled age', () => {
    const [p] = layoutMarkers([marker('1:retirement', 65)], x, bounds)
    expect(p!.x).toBe(650)
    expect(p!.row).toBe(0)
    expect(p!.left).toBe(654) // chip sits just right of the hairline
  })

  it('keeps well-separated markers on the same row', () => {
    const placed = layoutMarkers([marker('a', 50), marker('b', 80)], x, bounds)
    expect(placed.map((p) => p.row)).toEqual([0, 0])
  })

  it('staggers clustered markers into rows', () => {
    const placed = layoutMarkers(
      [marker('a', 65, 'Brian'), marker('b', 65, 'Dana'), marker('c', 66, 'Brian')],
      x,
      bounds,
    )
    const rows = placed.map((p) => p.row)
    expect(new Set(rows).size).toBe(3) // all three would collide → 3 rows
    // no two chips in one row overlap
    const byRow = new Map<number, [number, number][]>()
    for (const p of placed) {
      const list = byRow.get(p.row) ?? []
      for (const [l, r] of list) {
        expect(p.left >= r || p.left + p.width <= l).toBe(true)
      }
      list.push([p.left, p.left + p.width])
      byRow.set(p.row, list)
    }
  })

  it('flips the chip to the left of the hairline near the right edge', () => {
    const [p] = layoutMarkers([marker('a', 89)], x, bounds)
    expect(p!.x).toBe(890)
    expect(p!.left + p!.width).toBeLessThanOrEqual(bounds.maxX)
    expect(p!.left).toBeLessThan(p!.x)
  })

  it('drops markers outside the age range and sorts by age', () => {
    const placed = layoutMarkers(
      [marker('late', 95), marker('b', 70), marker('a', 50), marker('early', 30)],
      x,
      bounds,
    )
    expect(placed.map((p) => p.key)).toEqual(['a', 'b'])
  })

  it('is deterministic for equal ages (ties broken by key)', () => {
    const a = layoutMarkers([marker('b', 65), marker('a', 65)], x, bounds)
    const b = layoutMarkers([marker('a', 65), marker('b', 65)], x, bounds)
    expect(a.map((p) => p.key)).toEqual(b.map((p) => p.key))
  })
})

describe('toMarkers', () => {
  const milestones: Milestone[] = [
    { age: 65, year: 2045, kind: 'retirement', label: 'Brian retires', member_id: 1 },
    { age: 67, year: 2047, kind: 'ss_start', label: 'Brian claims Social Security (100% of FRA)', member_id: 1 },
    { age: 75, year: 2055, kind: 'rmd_start', label: 'RMDs begin for Dana Q.', member_id: 2 },
  ]

  it('builds stable identity keys per member+kind', () => {
    const m = toMarkers(milestones)
    expect(m.map((d) => d.key)).toEqual(['1:retirement', '1:ss_start', '2:rmd_start'])
  })

  it('uses the household name lookup for chip labels (first name only)', () => {
    const m = toMarkers(milestones, (id) => (id === 1 ? 'Brian Stinson' : 'Dana Q. Stinson'))
    expect(m.map((d) => d.shortLabel)).toEqual(['Brian', 'Brian', 'Dana'])
  })

  it('falls back to parsing the engine label when no lookup is given', () => {
    const m = toMarkers(milestones)
    expect(m[0]!.shortLabel).toBe('Brian')
    expect(m[2]!.shortLabel).toBe('Q.') // last word of the RMD label — lookup preferred
  })
})

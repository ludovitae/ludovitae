/** Milestone marker layout — pure math, no React/DOM, unit-testable.
 * Markers are first-class chart citizens: a hairline at the event age plus a
 * compact chip (icon + short label) near the top; chips stagger into rows
 * when they would collide, and flip to the left of their hairline near the
 * right edge so they never overflow the plot. */

import type { Milestone, MilestoneKind } from '@/api/types'

export interface MarkerDatum {
  /** stable identity for tweening: `${member_id}:${kind}` */
  key: string
  age: number
  kind: MilestoneKind
  /** full label (probe/hover), from the engine */
  label: string
  /** compact chip text (member's first name) */
  shortLabel: string
}

export interface PlacedMarker extends MarkerDatum {
  /** hairline x (px) */
  x: number
  /** chip left edge (px) */
  left: number
  /** collision row, 0 = topmost */
  row: number
  /** chip width (px) */
  width: number
}

/** Map engine milestones to chart markers. `nameOf` supplies member names
 * (household lookup); the fallback parses the engine label. */
export function toMarkers(
  milestones: Milestone[],
  nameOf?: (memberId: number) => string | undefined,
): MarkerDatum[] {
  return milestones.map((ms) => ({
    key: `${ms.member_id}:${ms.kind}`,
    age: ms.age,
    kind: ms.kind,
    label: ms.label,
    shortLabel: firstName(nameOf?.(ms.member_id) ?? nameFromLabel(ms)),
  }))
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

function nameFromLabel(ms: Milestone): string {
  // "Brian retires" / "Brian claims Social Security (…)" → first word;
  // "RMDs begin for Brian" → last word.
  const words = ms.label.trim().split(/\s+/)
  return (ms.kind === 'rmd_start' ? words[words.length - 1] : words[0]) ?? ''
}

export interface LayoutBounds {
  minAge: number
  maxAge: number
  /** plot x range (px) chips must stay inside */
  minX: number
  maxX: number
}

export interface LayoutOpts {
  /** estimated px per label character */
  charW?: number
  /** chip padding + icon allowance (px) */
  pad?: number
  /** min horizontal gap between chips in a row (px) */
  gap?: number
}

/** Place markers left-to-right; each chip takes the first row where it fits.
 * Deterministic and side-effect free. */
export function layoutMarkers(
  markers: MarkerDatum[],
  x: (age: number) => number,
  bounds: LayoutBounds,
  opts: LayoutOpts = {},
): PlacedMarker[] {
  const { charW = 6, pad = 26, gap = 6 } = opts
  const inRange = markers.filter((m) => m.age >= bounds.minAge && m.age <= bounds.maxAge)
  const sorted = [...inRange].sort((a, b) => a.age - b.age || a.key.localeCompare(b.key))
  const rowRight: number[] = []
  return sorted.map((m) => {
    const px = x(m.age)
    const width = pad + m.shortLabel.length * charW
    let left = px + 4
    if (left + width > bounds.maxX) left = px - width - 4
    if (left < bounds.minX) left = bounds.minX
    let row = 0
    while (row < rowRight.length && left < rowRight[row]! + gap) row++
    rowRight[row] = Math.max(rowRight[row] ?? -Infinity, left + width)
    return { ...m, x: px, left, row, width }
  })
}

/** Kind → color token (tokens.css :root, theme-consistent). */
export const MARKER_COLOR: Record<MilestoneKind, string> = {
  retirement: 'var(--ms-retirement)',
  ss_start: 'var(--ms-ss)',
  rmd_start: 'var(--ms-rmd)',
}

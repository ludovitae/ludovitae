/** Freshness badge presentation. The STATE is server-computed (never derived
 * client-side per the contract); this maps it to label/tone/tooltip copy. */

import type { Freshness } from '@/api/types'

export type FreshnessTone = 'positive' | 'warning' | 'negative' | 'muted'

export interface FreshnessMeta {
  label: string
  tone: FreshnessTone
  /** days-since-import tooltip copy */
  tooltip: string
}

/** Days between an ISO date/datetime and today (≥ 0). */
export function daysSince(iso: string | null | undefined, todayIso: string): number | null {
  if (!iso) return null
  const then = Date.parse(iso.slice(0, 10))
  const now = Date.parse(todayIso)
  if (Number.isNaN(then) || Number.isNaN(now)) return null
  return Math.max(0, Math.round((now - then) / 86_400_000))
}

export function freshnessMeta(freshness: Freshness, daysSinceImport: number | null): FreshnessMeta {
  const days =
    daysSinceImport === null
      ? null
      : daysSinceImport === 0
        ? 'Last import today'
        : daysSinceImport === 1
          ? 'Last import yesterday'
          : `Last import ${daysSinceImport} days ago`
  switch (freshness) {
    case 'fresh':
      return { label: 'Fresh', tone: 'positive', tooltip: days ?? 'Recently imported' }
    case 'aging':
      return { label: 'Aging', tone: 'warning', tooltip: days ?? 'Import getting old' }
    case 'stale':
      return { label: 'Stale', tone: 'negative', tooltip: days ?? 'Import overdue' }
    case 'never':
      return { label: 'Never', tone: 'muted', tooltip: 'No imports yet' }
    case 'off':
      return { label: 'Off', tone: 'muted', tooltip: 'Freshness not tracked for this account' }
  }
}

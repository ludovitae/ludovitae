/** Plan-vs-actuals status phrasing (v1.3, #21). Polarity-aware and honest:
 * "within normal range" is neutral, never alarming — normal market variance
 * is not "behind" (model-honesty precedent from the assumptions strip). */

import type { TrackingMetric, TrackingStatus } from '@/api/types'
import { formatMoney } from '@/lib/format'

export function statusTone(status: TrackingStatus | null): string {
  switch (status) {
    case 'ahead':
    case 'on_track':
      return 'text-positive'
    case 'behind':
      return 'text-negative'
    case 'within_normal_range':
      return 'text-ink-2' // calm, not alarming
    default:
      return 'text-ink-3'
  }
}

/** Short chip label for the snapshot list / dashboard stat. */
export function statusChip(status: TrackingStatus | null): string {
  switch (status) {
    case 'ahead':
      return 'Ahead'
    case 'behind':
      return 'Behind'
    case 'on_track':
      return 'On track'
    case 'within_normal_range':
      return 'Normal range'
    default:
      return '—'
  }
}

/** Full headline phrase, e.g. "$12,400 ahead of plan" / "$310/mo over plan". */
export function statusPhrase(
  metric: TrackingMetric,
  delta: number | null,
  status: TrackingStatus | null,
): string {
  if (delta == null || status == null) return 'No actuals yet'
  const mag = formatMoney(Math.abs(delta))
  const per = metric === 'net_worth' ? '' : '/mo'
  switch (status) {
    case 'within_normal_range':
      return 'Within normal range'
    case 'on_track':
      return 'On track with plan'
    case 'ahead':
      // for spending, "ahead" means under plan (good)
      return metric === 'spending' ? `${mag}/mo under plan` : `${mag}${per} ahead of plan`
    case 'behind':
      return metric === 'spending' ? `${mag}/mo over plan` : `${mag}${per} behind plan`
  }
}

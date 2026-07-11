/** Import-freshness badge (v1.2): dot + label pill with a days-since-import
 * tooltip. State comes from the server (account.freshness); this component
 * only presents it. Optionally renders as a button (accounts page uses that
 * to open the staleness-override popover). */

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import type { Freshness } from '@/api/types'
import { freshnessMeta } from '@/lib/freshness'
import type { FreshnessTone } from '@/lib/freshness'

const TONE_CLS: Record<FreshnessTone, { pill: string; dot: string }> = {
  positive: { pill: 'bg-positive/12 text-positive', dot: 'bg-positive' },
  warning: { pill: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  negative: { pill: 'bg-negative/12 text-negative', dot: 'bg-negative' },
  muted: { pill: 'bg-surface-2 text-ink-3', dot: 'bg-(--ink-3)' },
}

export function FreshnessBadge({
  freshness,
  daysSinceImport,
}: {
  freshness: Freshness
  daysSinceImport: number | null
}) {
  const meta = freshnessMeta(freshness, daysSinceImport)
  const tone = TONE_CLS[meta.tone]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
      title={meta.tooltip}
      aria-label={`Data ${meta.label.toLowerCase()} — ${meta.tooltip}`}
    >
      <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {meta.label}
    </span>
  )
}

/** Button flavor for interactive spots (opens the override popover). */
export const FreshnessBadgeButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    freshness: Freshness
    daysSinceImport: number | null
  }
>(function FreshnessBadgeButton({ freshness, daysSinceImport, className = '', ...rest }, ref) {
  const meta = freshnessMeta(freshness, daysSinceImport)
  const tone = TONE_CLS[meta.tone]
  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-shadow duration-150 hover:shadow-1 focus-visible:outline-2 focus-visible:outline-(--focus) ${tone.pill} ${className}`}
      title={`${meta.tooltip} — click to adjust the staleness threshold`}
      aria-label={`Data ${meta.label.toLowerCase()} — ${meta.tooltip}. Adjust staleness threshold.`}
      {...rest}
    >
      <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {meta.label}
    </button>
  )
})

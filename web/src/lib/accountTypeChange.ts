/** #30 decision-support: plain-language consequences of changing an
 * account's type, shown inline BEFORE save (an informative note, never a
 * scary modal — save proceeds normally). Empty array = nothing worth saying.
 *
 * Sources of truth for the behaviors described here:
 * - investment-activity exclusion: docs/API.md #26 investment semantics
 * - RMD treatment of retirement accounts: docs/API.md household section
 * - liability sign hints: docs/API.md T-009 sign conventions
 * - freshness defaults by type: docs/API.md import freshness */

import type { AccountType } from '@/api/types'
import { FRESHNESS_TRACKED_TYPES, LIABILITY_TYPES } from '@/api/types'

/** Server-side exclusion family (brokerage/retirement/hsa) — narrower than
 * the UI's INVESTABLE_TYPES, which includes savings for asset-class pickers. */
const INVESTMENT_ACTIVITY_TYPES: readonly AccountType[] = ['brokerage', 'retirement', 'hsa']

export function typeChangeConsequences(from: AccountType, to: AccountType): string[] {
  if (from === to) return []
  const notes: string[] = []
  const wasInvestment = INVESTMENT_ACTIVITY_TYPES.includes(from)
  const isInvestment = INVESTMENT_ACTIVITY_TYPES.includes(to)
  const wasLiability = LIABILITY_TYPES.includes(from)
  const isLiability = LIABILITY_TYPES.includes(to)

  if (isInvestment && !wasInvestment) {
    notes.push(
      'Transactions imported here from now on will be marked investment activity and left out of spending analytics — dividends and reinvestments aren’t spending.',
    )
  }
  if (wasInvestment && !isInvestment) {
    notes.push(
      'New imports will count in spending analytics again. Rows already marked investment activity keep that category until you recategorize them.',
    )
  }
  if (to === 'retirement' && from !== 'retirement') {
    notes.push(
      'Retirement accounts are tax-deferred in the simulation: the owner’s required minimum distributions start at age 73–75 and draw this balance down.',
    )
  }
  if (from === 'retirement' && to !== 'retirement') {
    notes.push(
      'This balance will no longer be drawn down by required minimum distributions in the simulation.',
    )
  }
  if (isLiability && !wasLiability) {
    notes.push(
      'The balance will count against your net worth as debt, and CSV imports get a sign check — exports that list charges as positive numbers are flagged for flipping.',
    )
  }
  if (wasLiability && !isLiability) {
    notes.push(
      'The balance will count toward your assets instead of your debt, and imports stop sign-checking for the charges-positive convention.',
    )
  }
  const wasTracked = FRESHNESS_TRACKED_TYPES.includes(from)
  const isTracked = FRESHNESS_TRACKED_TYPES.includes(to)
  if (wasTracked !== isTracked) {
    notes.push(
      isTracked
        ? 'Accounts of this type usually track import freshness. Your current setting is kept — turn it on below if you import into this account.'
        : 'Accounts of this type usually don’t track import freshness. Your current setting is kept — turn it off below if staleness badges aren’t useful here.',
    )
  }
  return notes
}

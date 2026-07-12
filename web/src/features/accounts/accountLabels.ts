import type { AccountType } from '@/api/types'

export const TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  hsa: 'HSA',
  property: 'Property',
  vehicle: 'Vehicle',
  other_asset: 'Other asset',
  mortgage: 'Mortgage',
  loan: 'Loan',
  credit_card: 'Credit card',
  other_liability: 'Other liability',
}

/** #30 external-link status line, from the read-only display mask:
 * null → no line; "···" (pre-mask link) → linked without digits;
 * "···1234" → auto-matched with the digits captured at link time. */
export function externalLinkLabel(masked: string | null): string | null {
  if (masked === null) return null
  if (masked === '···') return 'Linked to imports'
  return `Auto-matched to imports ending ${masked}`
}

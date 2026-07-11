/** Spending → Recurring: the subscription radar. A "possibly forgotten"
 * callout leads (the owner's forgotten-subscription hunter — warm, not
 * alarmist), then the active table with price-change badges, then lapsed.
 * Forgotten membership is server-decided (/spending/hotspots). */

import { Link } from 'react-router-dom'
import { useSpendingHotspots, useSpendingRecurring } from '@/api/queries'
import type { RecurringCharge } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import { formatDate, formatMoney } from '@/lib/format'
import {
  CADENCE_LABELS,
  groupRecurring,
  isSubscriptionLike,
  monthlyTotal,
  priceChangeLabel,
} from '@/lib/recurring'

export function RecurringTab() {
  const recurring = useSpendingRecurring()
  const hotspots = useSpendingHotspots(6)

  if (recurring.isPending || hotspots.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-80" />
      </div>
    )
  }

  const charges = recurring.data ?? []
  if (charges.length === 0) {
    return (
      <Card>
        <EmptyState
          illustration="file"
          title="No recurring charges found"
          hint="Once imported transactions show the same payee on a regular rhythm — at least three times — it lands on this radar, price changes and all."
          action={
            <Link to="/import">
              <Button variant="subtle">Go to Import</Button>
            </Link>
          }
        />
      </Card>
    )
  }

  const forgottenPayees = new Set((hotspots.data?.possibly_forgotten ?? []).map((r) => r.payee))
  const groups = groupRecurring(charges, forgottenPayees)
  // ruling 2026-07-11: segment true subscriptions (low amount variability)
  // from spending habits so the radar isn't polluted — stat tiles speak
  // about subscriptions; habits get their own section with a subtotal.
  const subscriptionsAll = [...groups.forgotten, ...groups.subscriptions].sort(
    (a, b) => b.monthly_equivalent - a.monthly_equivalent,
  )
  const monthly = monthlyTotal(subscriptionsAll)
  const habitsMonthly = monthlyTotal(groups.habits)

  return (
    <div className="flex flex-col gap-4">
      {/* stat row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Active subscriptions" value={String(subscriptionsAll.length)} sub="steady charges" />
        <StatTile label="Monthly total" value={formatMoney(monthly, { cents: true })} sub="subscriptions per month" />
        <StatTile label="Yearly equivalent" value={formatMoney(monthly * 12)} sub="if nothing changes" />
      </div>

      {groups.forgotten.length > 0 ? (
        <Card className="border-(--warning)/40">
          <CardHeader
            title="Possibly forgotten"
            hint="Quiet, unchanged charges running for a year or more — still using these?"
          />
          <ul className="divide-y divide-(--border) px-5 pt-1 pb-3">
            {groups.forgotten.map((c) => (
              <li key={c.payee} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{c.payee}</p>
                  <p className="text-[11px] text-ink-3">
                    {CADENCE_LABELS[c.cadence]} since {formatDate(c.first_seen)} · {c.occurrences} charges ·{' '}
                    {formatMoney(c.occurrences * c.typical_amount, { cents: false })} so far
                  </p>
                </div>
                <p className="num text-[13px] font-semibold text-ink">
                  {formatMoney(c.monthly_equivalent, { cents: true })}
                  <span className="font-normal text-ink-3">/mo</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Subscription radar"
          hint="Every regular charge detected from imported transactions"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs text-ink-3">
                <th className="px-5 py-2 font-medium">Payee</th>
                <th className="px-4 py-2 font-medium">Cadence</th>
                <th className="num px-4 py-2 text-right font-medium">Price</th>
                <th className="px-4 py-2 font-medium" aria-label="Price change" />
                <th className="num px-4 py-2 text-right font-medium">Monthly eq.</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <SectionRow label="Subscriptions & bills" detail={`${formatMoney(monthly, { cents: true })}/mo`} />
              {subscriptionsAll.map((c) => (
                <RadarRow key={c.payee} c={c} forgotten={forgottenPayees.has(c.payee)} />
              ))}
              {groups.habits.length > 0 ? (
                <>
                  <SectionRow
                    label="Spending habits"
                    detail={`${formatMoney(habitsMonthly, { cents: true })}/mo`}
                    hint="regular rhythm, variable amounts"
                  />
                  {groups.habits.map((c) => (
                    <RadarRow key={c.payee} c={c} />
                  ))}
                </>
              ) : null}
              {groups.lapsed.length > 0 ? (
                <>
                  <SectionRow label="Lapsed" />
                  {groups.lapsed.map((c) => (
                    <RadarRow key={c.payee} c={c} />
                  ))}
                </>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/** Table section divider: group label + optional subtotal, spanning the row. */
function SectionRow({ label, detail, hint }: { label: string; detail?: string; hint?: string }) {
  return (
    <tr className="border-b border-edge bg-surface-3">
      <th colSpan={7} scope="colgroup" className="px-5 py-1.5 text-left">
        <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</span>
        {hint ? <span className="ml-2 text-[11px] font-normal text-ink-3">{hint}</span> : null}
        {detail ? <span className="num float-right text-[11px] font-medium text-ink-2">{detail}</span> : null}
      </th>
    </tr>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-ink-3">{sub}</p>
    </Card>
  )
}

function RadarRow({ c, forgotten }: { c: RecurringCharge; forgotten?: boolean }) {
  // habits' "price change" is jitter, never a repricing — no badge there
  const change = isSubscriptionLike(c) ? priceChangeLabel(c.price_change_pct) : null
  return (
    <tr className={`border-b border-edge last:border-0 ${c.active ? '' : 'opacity-55'}`}>
      <td className="px-5 py-2.5">
        <p className="font-medium text-ink">{c.payee}</p>
        <p className="text-[11px] text-ink-3 capitalize">{c.category}</p>
      </td>
      <td className="px-4 py-2.5 text-[12px] text-ink-2">{CADENCE_LABELS[c.cadence]}</td>
      <td className="num px-4 py-2.5 text-right text-ink">
        {change ? (
          <span className="text-[11px] text-ink-3 line-through">
            {formatMoney(c.typical_amount, { cents: true })}{' '}
          </span>
        ) : null}
        {formatMoney(c.last_amount, { cents: true })}
      </td>
      <td className="px-4 py-2.5">
        {change ? (
          <span
            className={`num inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              c.price_change_pct > 0 ? 'bg-warning/15 text-warning' : 'bg-positive/15 text-positive'
            }`}
            title={`Price ${c.price_change_pct > 0 ? 'increased' : 'decreased'} from ${formatMoney(c.typical_amount, { cents: true })}`}
          >
            {change}
          </span>
        ) : null}
      </td>
      <td className="num px-4 py-2.5 text-right font-medium text-ink">
        {formatMoney(c.monthly_equivalent, { cents: true })}
      </td>
      <td className="px-4 py-2.5 text-[12px] text-ink-3">{formatDate(c.last_date)}</td>
      <td className="px-4 py-2.5">
        {c.active ? (
          forgotten ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
              Forgotten?
            </span>
          ) : (
            <span className="rounded-full bg-positive/15 px-2 py-0.5 text-[11px] font-medium text-positive">
              Active
            </span>
          )
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-3">
            Lapsed
          </span>
        )}
      </td>
    </tr>
  )
}

/** Spending → Hotspots: category spikes vs baseline, subscription price
 * increases, top merchants. Spike deltas wear status tones (spending up =
 * warning-red) with arrows + labels — never color alone; comparison bars
 * reuse the observed-panel pattern. */

import { useSpendingHotspots } from '@/api/queries'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import { formatMoney } from '@/lib/format'
import { priceChangeLabel } from '@/lib/recurring'

export function HotspotsTab() {
  const hotspots = useSpendingHotspots(6)

  if (hotspots.isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  const data = hotspots.data
  if (!data) return null
  const empty =
    data.category_spikes.length === 0 &&
    data.top_merchants.length === 0 &&
    data.price_increases.length === 0

  if (empty) {
    return (
      <Card>
        <EmptyState
          illustration="chart"
          title="No hotspots yet"
          hint="With a few months of imported transactions, anything that spikes against its own baseline shows up here."
        />
      </Card>
    )
  }

  const maxSpike = Math.max(
    1,
    ...data.category_spikes.flatMap((s) => [s.recent_monthly_avg, s.baseline_monthly_avg]),
  )
  const maxMerchant = Math.max(1, ...data.top_merchants.map((m) => m.monthly_avg))

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Category spikes"
            hint="Last 3 months against the 6-month baseline before them"
          />
          {data.category_spikes.length === 0 ? (
            <p className="px-5 pt-1 pb-5 text-[13px] text-ink-3">
              Nothing unusual — every category is tracking its baseline.
            </p>
          ) : (
            <ul className="divide-y divide-(--border) px-5 pt-1 pb-4">
              {data.category_spikes.map((s) => {
                const up = s.delta_pct > 0
                return (
                  <li key={s.category} className="flex items-center gap-3 py-2.5">
                    <div className="w-28 min-w-0 shrink-0">
                      <p className="truncate text-[13px] text-ink capitalize">{s.category}</p>
                      <p
                        className={`num text-[11px] font-semibold ${up ? 'text-negative' : 'text-positive'}`}
                      >
                        {up ? '▲' : '▼'} {Math.abs(s.delta_pct).toFixed(0)}%
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1" aria-hidden>
                      <MiniBar value={s.recent_monthly_avg} max={maxSpike} color="var(--chart-1)" />
                      <MiniBar value={s.baseline_monthly_avg} max={maxSpike} color="var(--chart-ref)" />
                    </div>
                    <p className="num w-32 shrink-0 text-right text-[12px] text-ink-2">
                      {formatMoney(s.recent_monthly_avg)}
                      <span className="text-ink-3"> vs {formatMoney(s.baseline_monthly_avg)}</span>
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
          {data.category_spikes.length > 0 ? (
            <p className="flex items-center gap-3 border-t border-edge px-5 py-2 text-[11px] text-ink-3" aria-hidden>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: 'var(--chart-1)' }} />
                recent
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: 'var(--chart-ref)' }} />
                baseline
              </span>
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Price increases" hint="Recurring charges that quietly went up" />
          {data.price_increases.length === 0 ? (
            <p className="px-5 pt-1 pb-5 text-[13px] text-ink-3">No price hikes detected. Rare — enjoy it.</p>
          ) : (
            <ul className="divide-y divide-(--border) px-5 pt-1 pb-4">
              {data.price_increases.map((c) => (
                <li key={c.payee} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{c.payee}</p>
                    <p className="num text-[11px] text-ink-3">
                      was {formatMoney(c.typical_amount, { cents: true })} → now{' '}
                      {formatMoney(c.last_amount, { cents: true })}
                    </p>
                  </div>
                  <span className="num rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                    {priceChangeLabel(c.price_change_pct)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Top merchants" hint="Monthly average over the window, transfers excluded" />
        {data.top_merchants.length === 0 ? (
          <p className="px-5 pt-1 pb-5 text-[13px] text-ink-3">No merchant activity in the window.</p>
        ) : (
          <ul className="flex flex-col gap-2.5 px-5 pt-2 pb-5">
            {data.top_merchants.map((m) => (
              <li key={m.payee} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">{m.payee}</p>
                  <p className="text-[11px] text-ink-3">{m.txn_count} txns</p>
                </div>
                <MiniBar value={m.monthly_avg} max={maxMerchant} color="var(--chart-1)" />
                <p className="num text-right text-[13px] font-medium text-ink">
                  {formatMoney(m.monthly_avg)}
                  <span className="font-normal text-ink-3">/mo</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 min-w-0 rounded-full bg-surface-2">
      {value > 0 ? (
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (value / max) * 100).toFixed(1)}%`, background: color, minWidth: 3 }}
        />
      ) : null}
    </div>
  )
}

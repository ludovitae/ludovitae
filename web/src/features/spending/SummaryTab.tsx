/** Spending → Summary: category × month heatmap from /spending/summary.
 * Window selector mirrors the observed panel (6/12/24 months); the previous
 * slice holds at reduced opacity while a new one loads. */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSpendingSummary } from '@/api/queries'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import { CategoryHeatmap } from '@/charts/CategoryHeatmap'
import { formatMoney, todayISO } from '@/lib/format'

const WINDOWS = [6, 12, 24] as const

function firstOfMonthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function SummaryTab() {
  const [months, setMonths] = useState<number>(12)
  const summary = useSpendingSummary(firstOfMonthsAgo(months - 1), todayISO())
  const data = summary.data

  return (
    <Card>
      <CardHeader
        title="Where it goes"
        hint={
          data
            ? `${formatMoney(data.grand_total)} across ${data.months.length} months — transfers excluded`
            : 'Category totals by month'
        }
        action={
          <div
            className="inline-flex rounded-(--radius-s) border border-edge bg-surface-3 p-0.5"
            role="radiogroup"
            aria-label="Summary window"
          >
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={months === w}
                onClick={() => setMonths(w)}
                className={`rounded-[calc(var(--radius-s)-2px)] px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                  months === w ? 'bg-surface text-ink shadow-1' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {w} mo
              </button>
            ))}
          </div>
        }
      />
      {summary.isPending ? (
        <div className="flex flex-col gap-2 px-5 pt-2 pb-5">
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      ) : !data || data.categories.length === 0 ? (
        <EmptyState
          illustration="chart"
          title="No spending to summarize"
          hint="Import transactions and the month-by-month picture appears here — every category, every month, one glance."
          action={
            <Link to="/import">
              <Button variant="subtle">Go to Import</Button>
            </Link>
          }
        />
      ) : (
        <div
          className={`px-5 pt-2 pb-4 transition-opacity duration-150 ${summary.isFetching ? 'opacity-80' : ''}`}
        >
          <CategoryHeatmap months={data.months} rows={data.categories} />
        </div>
      )}
    </Card>
  )
}

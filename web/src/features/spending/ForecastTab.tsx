/** Spending → Forecast: stacked recurring + variable projection from
 * /spending/forecast. Two-series stack (slots 1+2, dataviz-validated both
 * modes); the legend + per-series stat line under the chart is the visible
 * relief for the light-mode slot-2 contrast WARN. */

import { useSpendingForecast } from '@/api/queries'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import { StackedColumns } from '@/charts/StackedColumns'
import { formatMoney } from '@/lib/format'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortMonth(key: string): string {
  const m = MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? key
  return m === 'Jan' ? `${m} ’${key.slice(2, 4)}` : m
}

export function ForecastTab() {
  const forecast = useSpendingForecast(12)

  if (forecast.isPending) return <Skeleton className="h-96" />
  const data = forecast.data
  if (!data) return null

  // T-007 shape: variable_by_category is flat {category, monthly_avg} — the
  // client derives the constant series; recurring VARIES by month (annual
  // charges lump in their anniversary month), so the stat line shows the
  // monthly average.
  const variableMonthly = data.variable_by_category.reduce((s, c) => s + c.monthly_avg, 0)
  const variable = data.months.map(() => variableMonthly)
  const recurringAvg =
    data.recurring.length > 0 ? data.recurring.reduce((s, v) => s + v, 0) / data.recurring.length : 0

  if (recurringAvg + variableMonthly === 0) {
    return (
      <Card>
        <EmptyState
          illustration="chart"
          title="Nothing to project"
          hint="The forecast builds itself from your recurring charges and trailing averages — import transactions to give it something to chew on."
        />
      </Card>
    )
  }

  const topVariable = [...data.variable_by_category]
    .sort((a, b) => b.monthly_avg - a.monthly_avg)
    .slice(0, 6)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Next 12 months"
          hint="Recurring charges at their cadence, plus trailing-average variable spending"
          action={
            <span className="flex items-center gap-3 text-[11px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-[3px]" style={{ background: 'var(--chart-1)' }} />
                Recurring
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-[3px]" style={{ background: 'var(--chart-2)' }} />
                Variable
              </span>
            </span>
          }
        />
        <div className="px-3 pt-1 pb-1">
          <StackedColumns
            labels={data.months}
            series={[
              { name: 'Recurring', color: 'var(--chart-1)', values: data.recurring },
              { name: 'Variable', color: 'var(--chart-2)', values: variable },
            ]}
            height={260}
            ariaLabel="Twelve-month spending forecast, recurring plus variable"
            formatLabel={shortMonth}
          />
        </div>
        {/* visible per-series values (contrast relief; tooltips only enhance) */}
        <p className="border-t border-edge px-5 py-2.5 text-[12px] text-ink-2">
          ≈ <span className="num font-semibold text-ink">{formatMoney(recurringAvg)}</span>/mo recurring
          (annual charges land in their anniversary month) +{' '}
          <span className="num font-semibold text-ink">{formatMoney(variableMonthly)}</span>/mo variable ≈{' '}
          <span className="num font-semibold text-ink">{formatMoney(recurringAvg + variableMonthly)}</span>/mo —{' '}
          <span className="num">{formatMoney((recurringAvg + variableMonthly) * 12)}</span> over the year.
        </p>
      </Card>

      <Card>
        <CardHeader title="Variable spending, by category" hint="Trailing 6-month averages driving the projection" />
        <ul className="grid grid-cols-1 gap-x-8 px-5 pt-1 pb-4 sm:grid-cols-2">
          {topVariable.map((c) => (
            <li key={c.category} className="flex items-baseline justify-between gap-3 border-b border-(--border) py-2 last:border-0">
              <span className="truncate text-[13px] text-ink capitalize">{c.category}</span>
              <span className="num text-[13px] font-medium text-ink">
                {formatMoney(c.monthly_avg)}
                <span className="font-normal text-ink-3">/mo</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

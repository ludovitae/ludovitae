import { Link } from 'react-router-dom'
import { useDashboard } from '@/api/queries'
import type { DashboardData } from '@/api/types'
import { LIABILITY_TYPES } from '@/api/types'
import { AreaChart } from '@/charts/AreaChart'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import { formatMoney, formatMoneyDelta } from '@/lib/format'
import { PageHeader } from '@/layout/AppShell'
import { IconPlus } from '@/components/icons'

const TYPE_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  hsa: 'HSA',
  property: 'Property',
  vehicle: 'Vehicles',
  other_asset: 'Other assets',
  mortgage: 'Mortgage',
  loan: 'Loans',
  credit_card: 'Credit cards',
  other_liability: 'Other debts',
}

export function DashboardPage() {
  const { data, isPending } = useDashboard()

  if (isPending) return <DashboardSkeleton />
  if (!data) return null

  const hasAccounts = Object.keys(data.by_type).length > 0
  if (!hasAccounts) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <EmptyState
            illustration="coins"
            title="Let’s get your money on the board"
            hint="Add your accounts — checking, investments, the house, the mortgage — and your net worth appears here with history and projections."
            action={
              <Link to="/accounts">
                <Button variant="primary">
                  <IconPlus width={16} height={16} /> Add your first account
                </Button>
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  const monthAgo = data.history.length > 1 ? data.history[data.history.length - 2]!.net_worth : null
  const delta = monthAgo !== null ? data.net_worth - monthAgo : null

  return (
    <>
      <PageHeader title="Dashboard" hint="Where things stand today" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Hero */}
        <Card className="lg:col-span-3">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-6 py-5">
            <div>
              <p className="text-xs font-medium text-ink-3">Net worth</p>
              <p className="num-display mt-1 text-4xl font-semibold text-ink">
                {formatMoney(data.net_worth)}
              </p>
              {delta !== null ? (
                <p className={`num mt-1 text-[13px] font-medium ${delta >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {formatMoneyDelta(delta)} <span className="font-normal text-ink-3">past month</span>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-10 gap-y-3">
              <MiniStat label="Assets" value={formatMoney(data.assets)} />
              <MiniStat label="Liabilities" value={formatMoney(-data.liabilities)} negative />
              <MiniStat
                label="Monthly surplus"
                value={formatMoneyDelta(data.monthly_surplus)}
                positive={data.monthly_surplus >= 0}
                negative={data.monthly_surplus < 0}
              />
            </div>
          </div>
        </Card>

        {/* History */}
        <Card className="lg:col-span-2">
          <CardHeader title="Net worth over time" hint="From your balance snapshots" />
          <div className="px-3 pt-1 pb-3">
            {data.history.length >= 2 ? (
              <AreaChart
                points={data.history.map((h) => ({ date: h.date, value: h.net_worth }))}
                height={230}
              />
            ) : (
              <EmptyState
                illustration="chart"
                title="Not enough history yet"
                hint="Update balances now and then — each snapshot becomes a point on this chart."
              />
            )}
          </div>
        </Card>

        {/* Goals rail */}
        <Card>
          <CardHeader
            title="Goals"
            action={
              <Link to="/goals" className="text-xs font-medium text-accent hover:underline">
                View all
              </Link>
            }
          />
          <div className="flex flex-col gap-4 px-5 pt-2 pb-5">
            {data.goals_summary.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-3">
                No goals yet — name a dream on the Goals page.
              </p>
            ) : (
              [...data.goals_summary]
                .sort((a, b) => a.priority - b.priority)
                .slice(0, 4)
                .map((g) => <GoalRow key={g.id} name={g.name} emoji={g.emoji} funded={g.funded_amount} target={g.target_amount} />)
            )}
          </div>
        </Card>

        {/* Breakdown */}
        <Card className="lg:col-span-3">
          <CardHeader title="Balance by type" />
          <div className="grid grid-cols-1 gap-x-10 gap-y-1 px-5 pt-1 pb-5 md:grid-cols-2">
            <BreakdownColumn title="Assets" data={data} liabilities={false} />
            <BreakdownColumn title="Liabilities" data={data} liabilities />
          </div>
        </Card>
      </div>
    </>
  )
}

function MiniStat({
  label,
  value,
  positive,
  negative,
}: {
  label: string
  value: string
  positive?: boolean
  negative?: boolean
}) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p
        className={`num mt-1 text-lg font-semibold ${
          positive ? 'text-positive' : negative ? 'text-negative' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function GoalRow({
  name,
  emoji,
  funded,
  target,
}: {
  name: string
  emoji: string | null
  funded: number
  target: number
}) {
  const pct = target > 0 ? Math.min(1, funded / target) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-ink">
          <span className="mr-1.5">{emoji}</span>
          {name}
        </p>
        <p className="num shrink-0 text-xs text-ink-2">
          {formatMoney(funded)} <span className="text-ink-3">/ {formatMoney(target)}</span>
        </p>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-(--ease-out)"
          style={{ width: `${(pct * 100).toFixed(1)}%` }}
        />
      </div>
    </div>
  )
}

function BreakdownColumn({
  title,
  data,
  liabilities,
}: {
  title: string
  data: DashboardData
  liabilities: boolean
}) {
  const entries = Object.entries(data.by_type)
    .filter(([type]) => LIABILITY_TYPES.includes(type as never) === liabilities)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
  const max = Math.max(1, ...entries.map(([, v]) => v ?? 0))
  const color = liabilities ? 'var(--chart-8)' : 'var(--chart-1)'
  if (entries.length === 0)
    return (
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</p>
        <p className="text-[13px] text-ink-3">{liabilities ? 'Debt-free. Enjoy it.' : 'None yet.'}</p>
      </div>
    )
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</p>
      <div className="flex flex-col gap-2.5">
        {entries.map(([type, value]) => (
          <div key={type} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
            <p className="truncate text-[13px] text-ink-2">{TYPE_LABELS[type] ?? type}</p>
            <div className="h-2 min-w-0">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(((value ?? 0) / max) * 100).toFixed(1)}%`,
                  background: color,
                  opacity: 0.85,
                  minWidth: 3,
                }}
              />
            </div>
            <p className="num text-[13px] text-ink">{formatMoney(liabilities ? -(value ?? 0) : (value ?? 0))}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-28 lg:col-span-3" />
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
        <Skeleton className="h-48 lg:col-span-3" />
      </div>
    </>
  )
}

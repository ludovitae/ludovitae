import { PageHeader } from '@/layout/AppShell'
import { Skeleton } from '@/components/Skeleton'

export function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <Skeleton className="h-64" />
    </>
  )
}

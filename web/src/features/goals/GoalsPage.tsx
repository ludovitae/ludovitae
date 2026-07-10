import { PageHeader } from '@/layout/AppShell'
import { Skeleton } from '@/components/Skeleton'

export function GoalsPage() {
  return (
    <>
      <PageHeader title="Goals" />
      <Skeleton className="h-64" />
    </>
  )
}

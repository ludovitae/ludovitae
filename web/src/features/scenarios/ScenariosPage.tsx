import { PageHeader } from '@/layout/AppShell'
import { Skeleton } from '@/components/Skeleton'

export function ScenariosPage() {
  return (
    <>
      <PageHeader title="Scenario studio" />
      <Skeleton className="h-64" />
    </>
  )
}

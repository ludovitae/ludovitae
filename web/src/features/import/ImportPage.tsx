import { PageHeader } from '@/layout/AppShell'
import { Skeleton } from '@/components/Skeleton'

export function ImportPage() {
  return (
    <>
      <PageHeader title="Import" />
      <Skeleton className="h-64" />
    </>
  )
}

import { PageHeader } from '@/layout/AppShell'
import { Skeleton } from '@/components/Skeleton'

export function AccountsPage() {
  return (
    <>
      <PageHeader title="Accounts" />
      <Skeleton className="h-64" />
    </>
  )
}

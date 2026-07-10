import { PageHeader } from '@/layout/AppShell'
import { Skeleton } from '@/components/Skeleton'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <Skeleton className="h-64" />
    </>
  )
}

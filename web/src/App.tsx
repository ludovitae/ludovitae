import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { registerUnauthorizedHandler, setCsrfToken } from '@/api/client'
import { useSession } from '@/api/queries'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { AppShell } from '@/layout/AppShell'
import { LoginPage, SetupPage } from '@/features/auth/AuthScreens'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { HouseholdPage } from '@/features/household/HouseholdPage'
import { AccountsPage } from '@/features/accounts/AccountsPage'
import { AccountDetailPage } from '@/features/accounts/AccountDetailPage'
import { SpendingPage } from '@/features/spending/SpendingPage'
import { ScenariosPage } from '@/features/scenarios/ScenariosPage'
import { TrackingPage } from '@/features/tracking/TrackingPage'
import { GoalsPage } from '@/features/goals/GoalsPage'
import { ImportPage } from '@/features/import/ImportPage'
import { ReviewPage } from '@/features/review/ReviewPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

/** Gate: wait for session, adopt CSRF token, route to setup/login as needed. */
function RequireAuth() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      queryClient.clear()
      navigate('/login', { replace: true })
    })
  }, [navigate])

  useEffect(() => {
    if (session.data?.csrf_token) setCsrfToken(session.data.csrf_token)
  }, [session.data?.csrf_token])

  if (session.isPending) {
    return <div className="min-h-screen bg-page" aria-busy="true" />
  }
  if (session.isError) {
    return (
      <div className="grid min-h-screen place-items-center bg-page px-4 text-center">
        <div>
          <p className="text-sm font-semibold text-ink">Can’t reach the server</p>
          <p className="mt-1 text-[13px] text-ink-3">
            Check that the Game of Life server is running, then reload.
          </p>
        </div>
      </div>
    )
  }
  if (session.data.setup_required) return <Navigate to="/setup" replace />
  if (!session.data.authenticated)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/household', element: <HouseholdPage /> },
          { path: '/accounts', element: <AccountsPage /> },
          { path: '/accounts/:id', element: <AccountDetailPage /> },
          { path: '/spending', element: <SpendingPage /> },
          { path: '/scenarios', element: <ScenariosPage /> },
          { path: '/tracking', element: <TrackingPage /> },
          { path: '/goals', element: <GoalsPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/review', element: <ReviewPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
])

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

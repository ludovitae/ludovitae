import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useSettingsQuery } from '@/api/queries'
import { useTheme } from '@/theme/ThemeProvider'
import {
  IconAccounts,
  IconDashboard,
  IconGoals,
  IconImport,
  IconLogout,
  IconScenarios,
  IconSettings,
} from '@/components/icons'

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/accounts', label: 'Accounts', icon: IconAccounts },
  { to: '/scenarios', label: 'Scenarios', icon: IconScenarios },
  { to: '/goals', label: 'Goals', icon: IconGoals },
  { to: '/import', label: 'Import', icon: IconImport },
  { to: '/settings', label: 'Settings', icon: IconSettings },
]

export function AppShell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { theme, setTheme, setReduceMotion } = useTheme()

  // Server settings are the source of truth for the theme flag + motion.
  const settings = useSettingsQuery()
  useEffect(() => {
    if (settings.data) {
      setTheme(settings.data.theme)
      setReduceMotion(settings.data.reduce_motion)
    }
  }, [settings.data, setTheme, setReduceMotion])

  async function logout() {
    try {
      await api.auth.logout()
    } finally {
      qc.clear()
      navigate('/login')
    }
  }

  return (
    <div className="flex min-h-screen bg-page">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-edge bg-surface px-3 py-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <div className="leading-tight">
            <p className="text-[13px] font-semibold tracking-tight text-ink">Game of Life</p>
            <p className="text-[11px] text-ink-3">{theme === 'game' ? 'life, but playable' : 'financial simulator'}</p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5" aria-label="Primary">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-(--radius-s) px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-accent-soft text-ink'
                    : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={isActive ? 'text-accent' : 'text-ink-3'}>
                    <Icon />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-0.5 border-t border-edge pt-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-2.5 rounded-(--radius-s) px-2.5 py-2 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            <span className="text-ink-3">
              <IconLogout />
            </span>
            Lock
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-6 py-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="var(--accent-soft)" />
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="var(--accent)" strokeOpacity=".35" />
      <path
        d="M6.5 19c4 0 4.5-9.5 7.5-9.5 2.5 0 3 5.5 7.5 5.5"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="21.5" cy="15" r="1.8" fill="var(--accent)" />
    </svg>
  )
}

export function PageHeader({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {hint ? <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p> : null}
      </div>
      {action}
    </header>
  )
}

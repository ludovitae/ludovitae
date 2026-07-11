import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/api/client'
import { useSession, qk } from '@/api/queries'
import { Button } from '@/components/Button'
import { IconLock } from '@/components/icons'

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-(--radius-m) border border-edge bg-surface shadow-1 text-accent">
            <IconLock width={22} height={22} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">Game of Life</h1>
            <p className="mt-0.5 text-[13px] text-ink-3">Your money, simulated.</p>
          </div>
        </div>
        <div className="rounded-(--radius-l) border border-edge bg-surface p-6 shadow-2">{children}</div>
        <p className="mt-4 text-center text-[11px] text-ink-3">
          Private to your LAN. Nothing leaves this machine.
        </p>
      </div>
    </div>
  )
}

export function LoginPage() {
  const session = useSession()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session.data?.setup_required) return <Navigate to="/setup" replace />
  if (session.data?.authenticated) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.auth.login(password)
      await qc.invalidateQueries({ queryKey: qk.session })
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 429)
        setError('Too many attempts — take a breath and try again shortly.')
      else if (err instanceof ApiError && err.status === 401) setError('That password isn’t right.')
      else setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pw" className="text-xs font-medium text-ink-2">
            Password
          </label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 w-full rounded-(--radius-s) border border-edge bg-surface-3 px-3 text-sm text-ink transition-colors hover:border-edge-strong"
          />
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-negative">
            {error}
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={busy || password.length === 0} className="w-full">
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
    </AuthFrame>
  )
}

export function SetupPage() {
  const session = useSession()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // #27: after the password lands, one interstitial choice — demo or empty.
  const [phase, setPhase] = useState<'form' | 'choose'>('form')

  if (phase === 'choose') {
    return (
      <FirstRunChoice
        onDone={async () => {
          await qc.invalidateQueries()
          navigate('/', { replace: true })
        }}
      />
    )
  }

  if (session.data && !session.data.setup_required)
    return <Navigate to={session.data.authenticated ? '/' : '/login'} replace />

  const tooShort = password.length > 0 && password.length < 10
  const mismatch = confirm.length > 0 && confirm !== password
  const ready = password.length >= 10 && confirm === password

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await api.auth.setup(password)
      await api.auth.login(password)
      setPhase('choose')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink">Welcome — set your password</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          One password protects everything. At least 10 characters; a few words work best.
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-pw" className="text-xs font-medium text-ink-2">
            New password
          </label>
          <input
            id="new-pw"
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort}
            className="h-10 w-full rounded-(--radius-s) border border-edge bg-surface-3 px-3 text-sm text-ink transition-colors hover:border-edge-strong"
          />
          {tooShort ? <p className="text-[11px] text-warning">{10 - password.length} more characters to go</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-pw" className="text-xs font-medium text-ink-2">
            Confirm password
          </label>
          <input
            id="confirm-pw"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            className="h-10 w-full rounded-(--radius-s) border border-edge bg-surface-3 px-3 text-sm text-ink transition-colors hover:border-edge-strong"
          />
          {mismatch ? <p className="text-[11px] text-negative">Doesn’t match yet</p> : null}
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-negative">
            {error}
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={!ready || busy} className="w-full">
          {busy ? 'Setting up…' : 'Create & unlock'}
        </Button>
      </form>
    </AuthFrame>
  )
}

/** #27 first-run interstitial: explore with demo data, or start empty. */
function FirstRunChoice({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<'demo' | 'empty' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(mode: 'demo' | 'empty') {
    setBusy(mode)
    setError(null)
    try {
      // "Start empty" just proceeds — a fresh database is already empty.
      if (mode === 'demo') await api.admin.reset('demo', 'reset ludovitae')
      await onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
      setBusy(null)
    }
  }

  return (
    <AuthFrame>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink">You’re in — how do you want to start?</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          Either way, you can reset from Settings later.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void choose('demo')}
          disabled={busy !== null}
          className="rounded-(--radius-m) border border-edge bg-surface-2 p-4 text-left transition-colors duration-150 hover:border-(--accent) disabled:opacity-50"
        >
          <p className="text-[13px] font-semibold text-ink">
            {busy === 'demo' ? 'Setting the table…' : 'Explore with demo data'}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            A realistic household — accounts, spending history, scenarios — so every screen has
            something to show. Wipe it whenever you’re ready.
          </p>
        </button>
        <button
          type="button"
          onClick={() => void choose('empty')}
          disabled={busy !== null}
          className="rounded-(--radius-m) border border-edge bg-surface-2 p-4 text-left transition-colors duration-150 hover:border-(--accent) disabled:opacity-50"
        >
          <p className="text-[13px] font-semibold text-ink">
            {busy === 'empty' ? 'Opening…' : 'Start empty'}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            A blank slate. Add accounts by hand or import a bank export — new accounts can be
            created right from the import.
          </p>
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-negative">
          {error}
        </p>
      ) : null}
    </AuthFrame>
  )
}

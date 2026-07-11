import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { MOCK } from '@/api/client'
import { usePatchSettings, useProfile, useUpdateProfile } from '@/api/queries'
import type { Profile } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { Field, TextInput, Toggle } from '@/components/Field'
import { Skeleton } from '@/components/Skeleton'
import { IconCheck } from '@/components/icons'
import { useTheme } from '@/theme/ThemeProvider'
import type { ModePref, ThemeName } from '@/theme/ThemeProvider'
import { PageHeader } from '@/layout/AppShell'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" hint="Appearance, motion, and the numbers behind the simulation" />
      <div className="flex max-w-2xl flex-col gap-4">
        <AppearanceCard />
        <ProfileCard />
        {MOCK ? (
          <p className="px-1 text-[11px] text-ink-3">
            Running against the built-in mock API (VITE_MOCK=1) — data resets on reload, login state persists.
          </p>
        ) : null}
      </div>
    </>
  )
}

function AppearanceCard() {
  const { theme, setTheme, modePref, setModePref, reduceMotion, setReduceMotion } = useTheme()
  const patchSettings = usePatchSettings()

  function chooseTheme(t: ThemeName) {
    setTheme(t)
    patchSettings.mutate([{ theme: t }])
  }
  function chooseMotion(v: boolean) {
    setReduceMotion(v)
    patchSettings.mutate([{ reduce_motion: v }])
  }

  return (
    <Card>
      <CardHeader title="Appearance" />
      <div className="flex flex-col gap-5 px-5 pt-2 pb-5">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-2">Theme</p>
          <div className="grid grid-cols-2 gap-3">
            <ThemeSwatch
              name="fintech"
              title="Fintech"
              hint="Crisp, quiet, numbers first"
              selected={theme === 'fintech'}
              onSelect={() => chooseTheme('fintech')}
            />
            <ThemeSwatch
              name="game"
              title="Game"
              hint="Warm and rounded — life as a board"
              selected={theme === 'game'}
              onSelect={() => chooseTheme('game')}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-2">Mode</p>
          <div className="inline-flex rounded-(--radius-s) border border-edge bg-surface-3 p-0.5" role="radiogroup" aria-label="Color mode">
            {(['system', 'light', 'dark'] as ModePref[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={modePref === m}
                onClick={() => setModePref(m)}
                className={`rounded-[calc(var(--radius-s)-2px)] px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors duration-150 ${
                  modePref === m ? 'bg-surface text-ink shadow-1' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[13px] font-medium text-ink">Reduce motion</span>
            <span className="block text-xs text-ink-3">Charts snap instead of animating</span>
          </span>
          <Toggle checked={reduceMotion} onChange={chooseMotion} label="Reduce motion" />
        </label>
      </div>
    </Card>
  )
}

function ThemeSwatch({
  name,
  title,
  hint,
  selected,
  onSelect,
}: {
  name: ThemeName
  title: string
  hint: string
  selected: boolean
  onSelect: () => void
}) {
  const { resolvedMode } = useTheme()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-(--radius-m) border p-3 text-left transition-all duration-150 ${
        selected ? 'border-(--accent) bg-accent-soft' : 'border-edge hover:border-edge-strong'
      }`}
    >
      {/* miniature preview rendered in the target theme's own tokens */}
      <div data-theme={name} data-mode={resolvedMode} className="pointer-events-none mb-2.5 overflow-hidden rounded-(--radius-s) border border-edge">
        <div className="flex h-16 gap-1.5 p-2" style={{ background: 'var(--bg)' }}>
          <div className="w-1/4 rounded-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
          <div className="relative flex-1 rounded-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <svg viewBox="0 0 100 40" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
              <path d="M4 32C30 30 34 12 52 14s20 10 44 6" fill="none" stroke="var(--chart-1)" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M4 32C30 30 34 12 52 14s20 10 44 6 L96 40 L4 40 Z" fill="var(--chart-1)" opacity=".12" stroke="none" />
            </svg>
          </div>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        {title}
        {selected ? <IconCheck width={14} height={14} className="text-accent" /> : null}
      </p>
      <p className="text-[11px] text-ink-3">{hint}</p>
    </button>
  )
}

function ProfileCard() {
  const { data: profile, isPending } = useProfile()
  const update = useUpdateProfile()
  const [form, setForm] = useState<Profile | null>(null)
  const [savedTick, setSavedTick] = useState(false)

  useEffect(() => {
    if (profile && form === null) setForm(profile)
  }, [profile, form])

  if (isPending || !form) {
    return <Skeleton className="h-72" />
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(profile)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    update.mutate([form], {
      onSuccess: () => {
        setSavedTick(true)
        setTimeout(() => setSavedTick(false), 1600)
      },
    })
  }

  const num =
    (key: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: Number(e.target.value.replace(/[$,\s]/g, '')) || 0 })

  return (
    <Card>
      <CardHeader
        title="Plan profile"
        hint="Household-level assumptions — birthdays, retirement ages, and Social Security live on the Household page"
      />
      <form onSubmit={submit} className="grid grid-cols-2 gap-4 px-5 pt-2 pb-5 md:grid-cols-3">
        <Field label="Retirement spending / yr" hint="Takes over when the last earner retires">
          {(id) => <TextInput id={id} inputMode="decimal" className="num" value={String(form.annual_retirement_spending)} onChange={num('annual_retirement_spending')} />}
        </Field>
        <Field label="Inflation %">
          {(id) => <TextInput id={id} inputMode="decimal" className="num" value={String(form.inflation_pct)} onChange={num('inflation_pct')} />}
        </Field>
        <Field label="Effective tax rate %">
          {(id) => <TextInput id={id} inputMode="decimal" className="num" value={String(form.effective_tax_rate_pct)} onChange={num('effective_tax_rate_pct')} />}
        </Field>
        <div className="col-span-2 flex items-end justify-end gap-2 md:col-span-3">
          {savedTick ? (
            <span className="inline-flex items-center gap-1 pb-2 text-xs font-medium text-positive">
              <IconCheck width={14} height={14} /> Saved
            </span>
          ) : null}
          <Button variant="primary" type="submit" disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

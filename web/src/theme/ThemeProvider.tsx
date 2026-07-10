import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type ThemeName = 'fintech' | 'game'
export type ModePref = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  theme: ThemeName
  modePref: ModePref
  resolvedMode: 'light' | 'dark'
  reduceMotion: boolean
  setTheme: (t: ThemeName) => void
  setModePref: (m: ModePref) => void
  setReduceMotion: (v: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const THEME_KEY = 'gol.theme'
const MODE_KEY = 'gol.mode'
const MOTION_KEY = 'gol.reduceMotion'

function systemMode(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() =>
    localStorage.getItem(THEME_KEY) === 'game' ? 'game' : 'fintech',
  )
  const [modePref, setModePrefState] = useState<ModePref>(() => {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  })
  const [reduceMotion, setReduceMotionState] = useState<boolean>(
    () => localStorage.getItem(MOTION_KEY) === 'true',
  )
  const [sysMode, setSysMode] = useState<'light' | 'dark'>(systemMode)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSysMode(systemMode())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedMode = modePref === 'system' ? sysMode : modePref

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.setAttribute('data-mode', resolvedMode)
    root.setAttribute('data-reduce-motion', String(reduceMotion))
  }, [theme, resolvedMode, reduceMotion])

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t)
    localStorage.setItem(THEME_KEY, t)
  }, [])

  const setModePref = useCallback((m: ModePref) => {
    setModePrefState(m)
    if (m === 'system') localStorage.removeItem(MODE_KEY)
    else localStorage.setItem(MODE_KEY, m)
  }, [])

  const setReduceMotion = useCallback((v: boolean) => {
    setReduceMotionState(v)
    localStorage.setItem(MOTION_KEY, String(v))
  }, [])

  const value = useMemo(
    () => ({ theme, modePref, resolvedMode, reduceMotion, setTheme, setModePref, setReduceMotion }),
    [theme, modePref, resolvedMode, reduceMotion, setTheme, setModePref, setReduceMotion],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme outside ThemeProvider')
  return ctx
}

/** True when animation is allowed (OS preference AND app setting). */
// eslint-disable-next-line react-refresh/only-export-components
export function useMotionOK(): boolean {
  const { reduceMotion } = useTheme()
  const [osReduce, setOsReduce] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setOsReduce(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return !reduceMotion && !osReduce
}

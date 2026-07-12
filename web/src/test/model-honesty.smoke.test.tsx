/** T-011b model honesty: the assumptions strip renders from the response's
 * `assumptions` block, success probability displays at the nearest 5%, and
 * the "what moved" engine note shows once and stays dismissed. */

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

async function openStudio() {
  const user = userEvent.setup()
  render(<App />)
  // The app router is module-level, so a re-render may resume wherever the
  // previous test left off — clicking the nav link works from anywhere.
  const link = await screen.findByRole('link', { name: 'Scenarios' }, { timeout: 8000 })
  await user.click(link)
  await screen.findByText('Projected net worth', undefined, { timeout: 8000 })
  return user
}

describe('assumptions strip (T-011b)', () => {
  it('renders collapsed from response data and expands to plain-language limits', async () => {
    const user = await openStudio()

    // Collapsed one-liner: values come from the mock engine's assumptions
    // block (stocks 7±15, bonds 3.5±7, inflation 2.5, tax 18, SS 85%, v2).
    const strip = await screen.findByRole('button', { name: /^Assumes:/ }, { timeout: 8000 })
    expect(strip.textContent).toContain('stocks 7%±15%')
    expect(strip.textContent).toContain('bonds 3.5%±7%')
    expect(strip.textContent).toContain('inflation 2.5%')
    expect(strip.textContent).toContain('flat 18% tax')
    expect(strip.textContent).toContain('85% of SS taxable')
    expect(strip.textContent).toContain('engine v4')
    expect(strip.getAttribute('aria-expanded')).toBe('false')

    // Expanded: full block with the verbatim flat-tax caveat (task spec)
    // and the model-risk limit sentence.
    await user.click(strip)
    expect(strip.getAttribute('aria-expanded')).toBe('true')
    expect(
      screen.getByText(/flat tax = approximate dollar impacts for claim-age\/RMD decisions/),
    ).toBeTruthy()
    expect(screen.getByText(/don.t show\s+model risk/)).toBeTruthy()

    // Expanded state persists for the session.
    expect(sessionStorage.getItem('gol.assumptionsStrip.expanded')).toBe('1')
    await user.click(strip)
    expect(sessionStorage.getItem('gol.assumptionsStrip.expanded')).toBe('0')

    cleanup()
  }, 30000)
})

describe('success probability rounding (T-011b)', () => {
  it('gauge shows the nearest 5% with the exact value in the title', async () => {
    await openStudio()

    const gauge = await screen.findByRole(
      'img',
      { name: /Chance the money lasts: about \d+%/ },
      { timeout: 8000 },
    )
    const shown = /about (\d+)%/.exec(gauge.getAttribute('aria-label') ?? '')
    expect(shown).not.toBeNull()
    expect(Number(shown![1]) % 5).toBe(0)
    // Exact run value stays reachable via the title.
    expect(gauge.getAttribute('title')).toMatch(/About \d+% — this run computed \d+%/)

    cleanup()
  }, 30000)
})

describe('what-moved engine note (T-011b)', () => {
  it('shows once after a version change and stays dismissed', async () => {
    // Dev/test hook (documented in lib/engineVersion.ts): pretend this
    // browser last saw engine v1 — the mock responds with v2.
    localStorage.setItem('gol.engine.lastSeen', '1')
    localStorage.removeItem('gol.engine.dismissed')

    let user = await openStudio()
    const note = await screen.findByText(
      /The engine behind these numbers changed/,
      undefined,
      { timeout: 8000 },
    )
    expect(note.textContent).toContain('v1 → v4')
    // engine_notes come from the response verbatim.
    expect(
      screen.getByText(/Bracket-aware federal tax when the flat-rate override is unset/),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByText(/The engine behind these numbers changed/)).toBeNull()
    expect(localStorage.getItem('gol.engine.lastSeen')).toBe('4')
    cleanup()

    // Fresh mount: dismissed pair never resurfaces — but give the studio a
    // beat to have re-rendered before asserting absence.
    user = await openStudio()
    await screen.findByRole('button', { name: /^Assumes:/ }, { timeout: 8000 })
    await waitFor(() =>
      expect(screen.queryByText(/The engine behind these numbers changed/)).toBeNull(),
    )
    void user
    cleanup()
  }, 30000)
})

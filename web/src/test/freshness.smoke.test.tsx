/** T-008 jsdom walk of freshness: account badges with days-since tooltips,
 * the staleness-override popover (real form), and the dashboard warning
 * strip that links to Accounts. */

// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

// cleanup must run even when a test fails, or the next test sees two Apps
afterEach(cleanup)

describe('import freshness (mock API)', () => {
  it('shows the dashboard stale strip and it navigates to Accounts', async () => {
    const user = userEvent.setup()
    render(<App />)

    // savings is aging (27d), brokerage is stale (61d) → 2 accounts
    const strip = await screen.findByRole(
      'link',
      { name: /2 accounts need fresh data/ },
      { timeout: 8000 },
    )
    expect(strip.textContent).toContain('1 already stale')
    expect(strip.textContent).toContain('High-Yield Savings (27d)')
    expect(strip.textContent).toContain('Vanguard Brokerage (61d)')

    // dismiss = navigate, not suppress
    await user.click(strip)
    await screen.findByText('Balances are snapshots — edit inline to record today’s number', undefined, {
      timeout: 8000,
    })
  }, 60000)

  it('renders badges per state and edits the staleness override via the popover', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('link', { name: 'Accounts' }, { timeout: 8000 }))
    await screen.findByText('Everyday Checking', undefined, { timeout: 8000 })

    // one badge per state, with days-since tooltips in the accessible name
    await screen.findAllByRole('button', { name: /Data fresh — Last import/ }, { timeout: 8000 })
    expect(screen.getByRole('button', { name: /Data aging — Last import 27 days ago/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Data stale — Last import 61 days ago/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Data never — No imports yet/ }).length).toBeGreaterThan(0)
    // non-transactional accounts (house, mortgage…) show no badge at all
    const houseRow = screen.getByText('House').closest('li')!
    expect(within(houseRow).queryByRole('button', { name: /^Data / })).toBeNull()

    // raise the brokerage threshold to 90 days → 61d becomes aging (2/3 of 90 = 60)
    await user.click(screen.getByRole('button', { name: /Data stale — Last import 61 days ago/ }))
    const input = await screen.findByLabelText('Warn when older than (days)')
    await user.type(input, '90')
    const save = screen.getByRole('button', { name: 'Save' })
    expect((save as HTMLButtonElement).type).toBe('submit')
    await user.click(save)
    await waitFor(
      () => expect(screen.getByRole('button', { name: /Data aging — Last import 61 days ago/ })).toBeTruthy(),
      { timeout: 8000 },
    )
  }, 60000)
})

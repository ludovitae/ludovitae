/** Smoke test: mount the real App against the mock API (VITE_MOCK=1) and
 * walk every screen — catches runtime crashes the type checker can't. */

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  // Mock auth: password already set + logged in.
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

describe('app smoke (mock API)', () => {
  it('walks every screen without crashing', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Dashboard
    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    await screen.findByText('Balance by type', undefined, { timeout: 8000 })

    // Accounts
    await user.click(screen.getByRole('link', { name: 'Accounts' }))
    await screen.findByText('Vanguard Brokerage', undefined, { timeout: 8000 })
    expect(screen.getByText('Liabilities')).toBeTruthy()

    // Scenario studio (fan chart + gauge appear after debounce + mock latency)
    await user.click(screen.getByRole('link', { name: 'Scenarios' }))
    await screen.findByRole('tab', { name: 'Retire at 55' }, { timeout: 8000 })
    await screen.findByText('Projected net worth', undefined, { timeout: 8000 })
    await screen.findByRole('img', { name: /fan chart/i }, { timeout: 8000 })

    // Goals
    await user.click(screen.getByRole('link', { name: 'Goals' }))
    await screen.findByText('Sailboat', undefined, { timeout: 8000 })

    // Import
    await user.click(screen.getByRole('link', { name: 'Import' }))
    await screen.findByText(/Drop a CSV or OFX/, undefined, { timeout: 8000 })

    // Settings
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await screen.findByText('Appearance', undefined, { timeout: 8000 })
    await screen.findByText('Plan profile', undefined, { timeout: 8000 })

    cleanup()
  }, 60000)
})

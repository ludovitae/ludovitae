/** T-003 D-002 regression: Goal.emoji is nullable (backend model). A goal with
 * a null emoji must render the 🎯 fallback cleanly on both the dashboard and the
 * goals grid — never an empty gap (the old <span className="mr-1.5"> stub). */

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { goals } from '@/api/mock/db'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
  // priority 1 so it surfaces in the dashboard top-4 and near the top of the grid
  goals.push({
    id: 101, name: 'Mystery Fund', emoji: null, target_amount: 5000,
    target_date: null, priority: 1, funded_amount: 1000, notes: '',
  })
})

describe('null Goal.emoji renders cleanly', () => {
  it('dashboard goal row falls back to 🎯 instead of an empty gap', async () => {
    render(<App />)
    const label = await screen.findByText('Mystery Fund', undefined, { timeout: 8000 })
    const row = label.closest('p')
    expect(row).toBeTruthy()
    // the icon fallback is present in the same line, before the name
    expect(row!.textContent).toContain('🎯')
    cleanup()
  }, 30000)

  it('goals grid card shows the 🎯 fallback icon', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    await user.click(screen.getByRole('link', { name: 'Goals' }))
    const label = await screen.findByText('Mystery Fund', undefined, { timeout: 8000 })
    const card = label.closest('.group')
    expect(card).toBeTruthy()
    expect(card!.textContent).toContain('🎯')
    cleanup()
  }, 30000)
})

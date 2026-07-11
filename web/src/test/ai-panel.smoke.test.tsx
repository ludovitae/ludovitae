/** T-008 jsdom walk of Settings → AI panel: write-only key set/clear via the
 * real controls, budget edit, disabled stub toggle, zeroed usage ledger. */

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

describe('AI admin panel (mock API)', () => {
  it('sets and clears the write-only key, edits the budget, explains the stub', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('link', { name: 'Settings' }, { timeout: 8000 }))
    await screen.findByText('AI assistance', undefined, { timeout: 8000 })

    // the enable toggle is disabled and the stub is explained in plain words
    const toggle = screen.getByRole('switch', { name: 'Enable AI categorization' })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/categorization runs on local rules and heuristics for now/)).toBeTruthy()

    // no key yet → write-only field; saving shows the last4 chip, never the key
    const keyInput = await screen.findByLabelText('Claude API key')
    expect((keyInput as HTMLInputElement).type).toBe('password')
    await user.type(keyInput, 'sk-ant-test-key-x7Q2')
    const saveKey = screen.getByRole('button', { name: 'Save key' })
    expect((saveKey as HTMLButtonElement).type).toBe('submit')
    await user.click(saveKey)
    await screen.findByText(/•••• x7Q2/, undefined, { timeout: 8000 })
    expect(screen.queryByText(/sk-ant-test-key/)).toBeNull()

    // clear brings the field back
    await user.click(screen.getByRole('button', { name: 'Clear key' }))
    await screen.findByLabelText('Claude API key', undefined, { timeout: 8000 })

    // budget governor: edit + save, meter reflects the new cap
    const budget = screen.getByLabelText('Monthly budget (USD)')
    await user.clear(budget)
    await user.type(budget, '10')
    const setBudget = screen.getByRole('button', { name: 'Set budget' })
    expect((setBudget as HTMLButtonElement).type).toBe('submit')
    await user.click(setBudget)
    await waitFor(() => expect(screen.getByText(/of \$10\.00/)).toBeTruthy(), { timeout: 8000 })
    const meter = screen.getByRole('meter', { name: 'AI spend this month against budget' })
    expect(meter.getAttribute('aria-valuemax')).toBe('10')
    expect(meter.getAttribute('aria-valuenow')).toBe('0')

    // this-month stats + zeroed usage ledger
    expect(screen.getByText('Spent this month')).toBeTruthy()
    expect(screen.getByText('Tokens this month')).toBeTruthy()
    const table = screen.getByText('Usage by month').parentElement!
    const rows = within(table).getAllByRole('row')
    expect(rows.length).toBe(7) // header + 6 months
    expect(within(table).getAllByText('$0.00').length).toBe(6)
  }, 60000)
})

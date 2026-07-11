/** #27 jsdom walk of the Settings danger zone against the mock API: the card
 * stays restrained until expanded, each action demands the typed phrase, and
 * a successful reset lands back on the dashboard with the state swapped.
 * Real controls throughout. */

// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import * as db from '@/api/mock/db'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

afterEach(cleanup)

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(await screen.findByRole('link', { name: /Settings/ }, { timeout: 8000 }))
  await screen.findByText('Danger zone', undefined, { timeout: 8000 })
}

describe('settings danger zone (#27, mock API)', () => {
  it('stays collapsed until expanded; erase requires the exact phrase', async () => {
    const user = userEvent.setup()
    await openSettings(user)

    // restrained by default: no destructive buttons on screen
    expect(screen.queryByRole('button', { name: 'Erase everything' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show' }))
    await user.click(screen.getByRole('button', { name: 'Erase everything' }))

    // the modal's confirm stays disabled for anything but the exact phrase
    const dialog = await screen.findByRole('dialog', { name: 'Erase everything?' })
    expect(dialog).toBeTruthy()
    const input = screen.getByLabelText(/Type “reset ludovitae”/)
    const confirm = () =>
      screen.getAllByRole('button', { name: 'Erase everything' }).at(-1) as HTMLButtonElement
    expect(confirm().disabled).toBe(true)
    await user.type(input, 'reset ludovita')
    expect(confirm().disabled).toBe(true)
    await user.type(input, 'e')
    expect(confirm().disabled).toBe(false)

    // confirming wipes the mock db and navigates home
    await user.click(confirm())
    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    await waitFor(() => expect(db.accounts.length).toBe(0))
    expect(db.household.length).toBe(1)
    expect(db.household[0]!.role).toBe('self')
    expect(db.transactions.length).toBe(0)
  }, 40000)

  it('reset to demo data restores the demo household', async () => {
    const user = userEvent.setup()
    await openSettings(user)

    await user.click(screen.getByRole('button', { name: 'Show' }))
    await user.click(screen.getByRole('button', { name: 'Reset to demo data' }))
    await screen.findByRole('dialog', { name: 'Reset to demo data?' })
    await user.type(screen.getByLabelText(/Type “reset ludovitae”/), 'reset ludovitae')
    await user.click(
      screen.getAllByRole('button', { name: 'Reset to demo data' }).at(-1) as HTMLButtonElement,
    )

    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    await waitFor(() => expect(db.accounts.length).toBeGreaterThan(0))
    expect(db.transactions.length).toBeGreaterThan(0)
  }, 40000)
})

/** #30 jsdom walk of the account detail page: row → /accounts/:id
 * navigation, external-link status states, the type-change consequence note
 * (real select), the edit round-trip, and the pre-scoped import wizard
 * (locked picker, unlock affordance, commit into the scoped account). */

// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

// cleanup must run even when a test fails, or the next test sees two Apps
afterEach(cleanup)

/** The sidebar and the detail-page breadcrumb both link to Accounts —
 * navigate via the primary nav to keep queries unambiguous. */
async function gotoAccountsTable(user: ReturnType<typeof userEvent.setup>) {
  const nav = await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 8000 })
  await user.click(within(nav).getByRole('link', { name: 'Accounts' }))
}

async function openAccount(user: ReturnType<typeof userEvent.setup>, name: string) {
  await gotoAccountsTable(user)
  await user.click(await screen.findByRole('link', { name }, { timeout: 8000 }))
  await screen.findByText('Account settings', undefined, { timeout: 8000 })
}

describe('account detail page (mock API)', () => {
  it('shows the external-link status per state', async () => {
    const user = userEvent.setup()
    render(<App />)

    // digits captured at link time → auto-matched with the mask
    await openAccount(user, 'Vanguard Brokerage')
    await screen.findByText(/Auto-matched to imports ending ···4821/, undefined, { timeout: 8000 })

    // pre-mask "legacy" link → linked, no digits
    await openAccount(user, 'High-Yield Savings')
    await screen.findByText(/Linked to imports/, undefined, { timeout: 8000 })
    expect(screen.queryByText(/Auto-matched/)).toBeNull()

    // never linked → no link line at all
    await openAccount(user, 'Everyday Checking')
    expect(screen.queryByText(/Linked to imports|Auto-matched/)).toBeNull()
  }, 60000)

  it('shows the consequence note only for consequential type changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccount(user, 'Everyday Checking')

    // checking → retirement: investment exclusion + RMDs + net-worth side
    await user.selectOptions(await screen.findByLabelText('Type'), 'retirement')
    const note = await screen.findByRole('note', { name: 'What changes with this type' })
    expect(note.textContent).toMatch(/investment activity/i)
    expect(note.textContent).toMatch(/required minimum distributions/i)

    // checking → savings is equivalent in behavior: the note disappears
    await user.selectOptions(screen.getByLabelText('Type'), 'savings')
    expect(screen.queryByRole('note', { name: 'What changes with this type' })).toBeNull()

    // nothing was saved: the accounts table still shows Checking
    await gotoAccountsTable(user)
    const row = (await screen.findByRole('link', { name: 'Everyday Checking' }, { timeout: 8000 }))
      .closest('li')!
    expect(row.textContent).toContain('Checking')
  }, 60000)

  it('pre-scopes the import wizard, locks the picker, and commits into the account', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccount(user, 'Everyday Checking')

    await user.click(screen.getByRole('button', { name: /Import into this account/ }))

    // step 1: the picker is pre-selected, locked, and explains itself
    await screen.findByText(/Scoped to/, undefined, { timeout: 8000 })
    const picker = screen.getByLabelText('Into account') as HTMLSelectElement
    expect(picker.disabled).toBe(true)
    expect(picker.selectedOptions[0]?.textContent).toBe('Everyday Checking')
    expect(screen.getByRole('button', { name: 'Import elsewhere' })).toBeTruthy()

    // step 2 keeps the lock (scope beats preset defaults)
    await user.click(screen.getByRole('button', { name: 'Use a sample file' }))
    await screen.findByText('Map the columns', undefined, { timeout: 8000 })
    const target = screen.getByLabelText('Into account') as HTMLSelectElement
    expect(target.disabled).toBe(true)
    expect(target.selectedOptions[0]?.textContent).toBe('Everyday Checking')

    // the commit lands in the scoped account
    await user.click(screen.getByRole('button', { name: 'Import transactions' }))
    await screen.findByText(/imported into Everyday Checking/, undefined, { timeout: 8000 })
  }, 60000)

  it('unlocking the picker frees the account choice', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccount(user, 'Everyday Checking')
    await user.click(screen.getByRole('button', { name: /Import into this account/ }))

    await screen.findByText(/Scoped to/, undefined, { timeout: 8000 })
    await user.click(screen.getByRole('button', { name: 'Import elsewhere' }))
    const picker = screen.getByLabelText('Into account') as HTMLSelectElement
    expect(picker.disabled).toBe(false)
    await user.selectOptions(picker, 'High-Yield Savings')
    expect(picker.selectedOptions[0]?.textContent).toBe('High-Yield Savings')
    expect(screen.queryByText(/Scoped to/)).toBeNull()
  }, 60000)

  it('edits account details round-trip from the detail page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccount(user, 'Everyday Checking')

    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Daily Driver Checking')
    const institution = screen.getByLabelText('Institution')
    await user.clear(institution)
    await user.type(institution, 'First Tech Credit Union')

    const save = screen.getByRole('button', { name: 'Save changes' })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    await user.click(save)
    await screen.findByText('Saved', undefined, { timeout: 8000 })

    // the header and the accounts table both reflect the rename
    await screen.findByRole('heading', { name: 'Daily Driver Checking' }, { timeout: 8000 })
    await gotoAccountsTable(user)
    const row = (
      await screen.findByRole('link', { name: 'Daily Driver Checking' }, { timeout: 8000 })
    ).closest('li')!
    expect(row.textContent).toContain('First Tech Credit Union')
  }, 60000)
})

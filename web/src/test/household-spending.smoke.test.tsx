/** T-006 jsdom walk of the two v1.1 pages against the mock API. All
 * interactions go through real controls (click the actual buttons — see the
 * type=submit lesson, fix 8194bc3). */

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})


describe('household & spending pages (mock API)', () => {
  it('walks the Household page and adds a member through the real form', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    await user.click(screen.getByRole('link', { name: 'Household' }))

    // Member cards with computed ages + timing summaries.
    await screen.findByText('Brian', undefined, { timeout: 8000 })
    expect(screen.getByText('Dana')).toBeTruthy()
    expect(screen.getByText('Wren')).toBeTruthy()
    // claim-age factor is legible on the card (67 → 100%)
    expect(screen.getAllByText(/claims 67 \(100%\)/).length).toBeGreaterThan(0)

    // Exactly-one-self in the UI: no delete affordance on the self card.
    expect(screen.queryByRole('button', { name: 'Delete Brian' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Dana' })).toBeTruthy()
    expect(screen.getByText(/anchored to you/)).toBeTruthy()

    // Add a member by clicking the real submit button.
    await user.click(screen.getByRole('button', { name: /Add member/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Add household member' })
    const submit = within(dialog).getByRole('button', { name: 'Add member' })
    expect((submit as HTMLButtonElement).type).toBe('submit')

    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Nana June')
    await user.clear(within(dialog).getByLabelText('Birth year'))
    await user.type(within(dialog).getByLabelText('Birth year'), '1952')
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'other')
    await user.click(submit)

    await screen.findByText('Nana June', undefined, { timeout: 8000 })
    // age computed from birth year
    const card = screen.getByText('Nana June').closest('div')!.parentElement!
    expect(card.textContent).toContain(String(new Date().getFullYear() - 1952))

    cleanup()
  }, 40000)

  it('walks the Spending page: categories, window selector, use-observed, double-count warning', async () => {
    const user = userEvent.setup()
    render(<App />)

    // the module-level router keeps the previous test's location — navigate
    // by clicking the real nav link once the shell is up
    await user.click(await screen.findByRole('link', { name: 'Spending' }, { timeout: 8000 }))

    // Planned categories grouped essential vs discretionary.
    await screen.findByText('Planned spending', undefined, { timeout: 8000 })
    expect(screen.getByText('Groceries')).toBeTruthy()
    expect((await screen.findAllByText('Essential')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Discretionary').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Monthly savings target')).toBeTruthy()

    // Double-count warning: expense flows + categories both count.
    await screen.findByText(/Both counted in the simulation/, undefined, { timeout: 8000 })

    // Observed panel with the default 12-month window.
    await screen.findByText(/trailing 12 months/, undefined, { timeout: 8000 })
    const plannedBefore = screen.getByLabelText('Monthly amount for Groceries').textContent

    // Window selector is a real radiogroup.
    await user.click(screen.getByRole('radio', { name: '6 mo' }))
    await screen.findByText(/trailing 6 months/, undefined, { timeout: 8000 })

    // "Use observed" on the Groceries row copies the observed average in.
    const groceriesRow = (await screen.findAllByText('Groceries'))
      .map((el) => el.closest('li'))
      .find((li) => li && within(li).queryByRole('button', { name: 'Use observed' }))
    expect(groceriesRow).toBeTruthy()
    await user.click(within(groceriesRow!).getByRole('button', { name: 'Use observed' }))
    await waitFor(
      () =>
        expect(screen.getByLabelText('Monthly amount for Groceries').textContent).not.toBe(
          plannedBefore,
        ),
      { timeout: 8000 },
    )

    // Recurring flows table has a real owner picker per row.
    expect(screen.getByLabelText('Owner of Salary — Brian')).toBeTruthy()

    // Add-category modal submits via a real type=submit button.
    await user.click(screen.getByRole('button', { name: /Add category/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Add spending category' })
    const submit = within(dialog).getByRole('button', { name: 'Add category' })
    expect((submit as HTMLButtonElement).type).toBe('submit')
    await user.type(within(dialog).getByLabelText('Name'), 'Pets')
    await user.click(submit)
    // appears in the plan list and as a merged observed-panel row
    expect((await screen.findAllByText('Pets', undefined, { timeout: 8000 })).length).toBeGreaterThan(0)

    cleanup()
  }, 40000)
})

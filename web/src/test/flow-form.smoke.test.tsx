/** T-009 jsdom walk of the flow add/edit/delete modal on the Spending hub,
 * against the mock API. All interactions through real controls (type=submit
 * buttons, labeled fields — the lesson stands). The dialog is re-queried per
 * interaction: background refetches re-render the card, and a held element
 * reference can go stale mid-test. */

// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

afterEach(cleanup)

async function openSpendingPlan(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(await screen.findByRole('link', { name: /Spending/ }, { timeout: 8000 }))
  // wait for a seeded flow ROW (not just the card title) so the table has
  // fully swapped in before any clicking
  await screen.findByText('Salary — Brian', undefined, { timeout: 8000 })
}

function dialog(name: string) {
  return within(screen.getByRole('dialog', { name }))
}

describe('flow form (mock API)', () => {
  it('adds a flow through the modal form', async () => {
    const user = userEvent.setup()
    await openSpendingPlan(user)

    await user.click(screen.getByRole('button', { name: 'Add flow' }))
    await screen.findByRole('dialog', { name: 'Add flow' })

    await user.type(dialog('Add flow').getByLabelText('Name'), 'Umbrella insurance')
    await user.selectOptions(dialog('Add flow').getByLabelText('Kind'), 'expense')
    await user.type(dialog('Add flow').getByLabelText('Monthly amount'), '120')
    await user.clear(dialog('Add flow').getByLabelText('Growth %/yr'))
    await user.type(dialog('Add flow').getByLabelText('Growth %/yr'), '2')
    // owner picker is a real select
    await user.selectOptions(dialog('Add flow').getByLabelText('Owner'), 'Brian')
    // expense should not auto-stop at retirement
    await user.click(dialog('Add flow').getByRole('switch', { name: 'Ends at retirement' }))

    await user.click(dialog('Add flow').getByRole('button', { name: 'Add flow' }))

    // the new row lands in the table with its amount and owner
    const row = (await screen.findByText('Umbrella insurance', undefined, { timeout: 8000 }))
      .closest('tr')!
    expect(within(row).getByText('$120')).toBeTruthy()
    expect((within(row).getByLabelText('Owner of Umbrella insurance') as HTMLSelectElement).value)
      .toBe('1')
  }, 30000)

  it('requires an account for contribution flows', async () => {
    const user = userEvent.setup()
    await openSpendingPlan(user)

    await user.click(screen.getByRole('button', { name: 'Add flow' }))
    await screen.findByRole('dialog', { name: 'Add flow' })
    await user.type(dialog('Add flow').getByLabelText('Name'), '529 plan')
    await user.type(dialog('Add flow').getByLabelText('Monthly amount'), '250')
    await user.selectOptions(dialog('Add flow').getByLabelText('Kind'), 'contribution')

    // no linked account yet -> submit disabled
    expect(
      (dialog('Add flow').getByRole('button', { name: 'Add flow' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await user.selectOptions(dialog('Add flow').getByLabelText('Into account'), 'Vanguard Brokerage')
    const submit = dialog('Add flow').getByRole('button', { name: 'Add flow' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await user.click(submit)
    await screen.findByText('529 plan', undefined, { timeout: 8000 })
  }, 30000)

  it('edits and deletes a flow through the modal', async () => {
    const user = userEvent.setup()
    await openSpendingPlan(user)

    // add a disposable flow first (keeps the seeded flows untouched)
    await user.click(screen.getByRole('button', { name: 'Add flow' }))
    await screen.findByRole('dialog', { name: 'Add flow' })
    await user.type(dialog('Add flow').getByLabelText('Name'), 'Gym membership')
    await user.selectOptions(dialog('Add flow').getByLabelText('Kind'), 'expense')
    await user.type(dialog('Add flow').getByLabelText('Monthly amount'), '55')
    await user.click(dialog('Add flow').getByRole('button', { name: 'Add flow' }))
    await screen.findByText('Gym membership', undefined, { timeout: 8000 })

    // edit: change the amount through the same modal
    await user.click(screen.getByRole('button', { name: 'Edit flow Gym membership' }))
    await screen.findByRole('dialog', { name: 'Edit Gym membership' })
    const amount = dialog('Edit Gym membership').getByLabelText('Monthly amount')
    await user.clear(amount)
    await user.type(amount, '65')
    await user.click(dialog('Edit Gym membership').getByRole('button', { name: 'Save changes' }))
    const row = (await screen.findByText('Gym membership', undefined, { timeout: 8000 })).closest('tr')!
    await within(row).findByText('$65', undefined, { timeout: 8000 })

    // delete: two-step confirm inside the edit modal
    await user.click(screen.getByRole('button', { name: 'Edit flow Gym membership' }))
    await screen.findByRole('dialog', { name: 'Edit Gym membership' })
    await user.click(
      dialog('Edit Gym membership').getByRole('button', { name: 'Delete flow Gym membership' }),
    )
    await user.click(
      dialog('Edit Gym membership').getByRole('button', {
        name: 'Confirm delete flow Gym membership',
      }),
    )
    await waitFor(() => expect(screen.queryByText('Gym membership')).toBeNull(), { timeout: 8000 })
  }, 40000)
})

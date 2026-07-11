/** T-008 jsdom walk of the Review page: pairing a transfer candidate through
 * real buttons, dismissing one, bulk categorization, suggestion chips, and
 * the create-rule-from-payee modal. Mock db state persists within this file,
 * so the flow is one ordered test. */

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

describe('review queues (mock API)', () => {
  it('pairs and dismisses transfer candidates with both legs shown', async () => {
    const user = userEvent.setup()
    render(<App />)

    // live nav badge: 2 candidates + 16 uncategorized underneath, but
    // attention economics caps the display at 9+ (owner rule, DESIGN.md)
    const reviewLink = await screen.findByRole('link', { name: /Review/ }, { timeout: 8000 })
    await waitFor(() => expect(reviewLink.textContent).toContain('9+'), { timeout: 8000 })
    await user.click(reviewLink)

    // both candidates render with score pills and both legs side-by-side
    await screen.findByText('86% match', undefined, { timeout: 8000 })
    expect(screen.getByText('58% match')).toBeTruthy()
    // account names arrive with the (parallel) accounts query
    expect((await screen.findAllByText('Everyday Checking', undefined, { timeout: 8000 })).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sapphire Card').length).toBeGreaterThan(0)
    expect(screen.getByText(/−\$1,389\.42/)).toBeTruthy()
    expect(screen.getByText(/\+\$1,389\.24/)).toBeTruthy()

    // pair the 86% candidate through the real button
    await user.click(screen.getByRole('button', { name: /Pair Sapphire Card Payment/ }))
    await waitFor(() => expect(screen.queryByText('86% match')).toBeNull(), { timeout: 8000 })

    // dismiss the other — a real POST /transfers/candidates/dismiss
    // tombstone (ruling 2026-07-11); the queue refetches empty
    await user.click(screen.getByRole('button', { name: /Dismiss candidate/ }))
    await screen.findByText('No transfers waiting', undefined, { timeout: 8000 })
  }, 60000)

  it('a dismissed candidate stays gone (persistent tombstone, not view state)', async () => {
    const user = userEvent.setup()
    render(<App />)

    // fresh mount over the same mock db: the dismissal from the previous
    // test holds server-side — nothing resurfaces
    await user.click(await screen.findByRole('link', { name: /Review/ }, { timeout: 8000 }))
    await screen.findByText('No transfers waiting', undefined, { timeout: 8000 })
    expect(screen.queryByText(/% match/)).toBeNull()
  }, 40000)

  it('bulk categorizes, applies a suggestion chip, and creates a rule from a payee', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('link', { name: /Review/ }, { timeout: 8000 }))
    await screen.findByText('Uncategorized transactions', undefined, { timeout: 8000 })
    const rowsBefore = await screen.findAllByRole('checkbox', { name: /^Select .* on / })
    expect(rowsBefore.length).toBeGreaterThanOrEqual(5)

    // --- suggestion chips (heuristic suggest) ---
    await user.click(screen.getByRole('button', { name: /Suggest categories/ }))
    const chips = await screen.findAllByRole('button', { name: /dining · \d+%/ }, { timeout: 8000 })
    expect(chips.length).toBeGreaterThan(0)
    const chipCount = chips.length
    await user.click(chips[0]!)
    await waitFor(
      () => expect(screen.queryAllByRole('button', { name: /dining · \d+%/ }).length).toBeLessThan(chipCount),
      { timeout: 8000 },
    )

    // --- bulk select + categorize ---
    const amazonRows = screen.getAllByRole('checkbox', { name: /Select AMZN/ })
    for (const cb of amazonRows) await user.click(cb)
    await user.type(screen.getByLabelText('Category for selected transactions'), 'shopping')
    const bulkBtn = screen.getByRole('button', { name: /Categorize \d+/ })
    expect((bulkBtn as HTMLButtonElement).type).toBe('submit')
    await user.click(bulkBtn)
    await waitFor(() => expect(screen.queryAllByRole('checkbox', { name: /Select AMZN/ })).toHaveLength(0), {
      timeout: 8000,
    })

    // --- create rule from payee (pre-filled modal) ---
    const pineRules = screen.getAllByRole('button', { name: 'Create rule from TST* PINE STATE BISCUITS' })
    await user.click(pineRules[0]!)
    const dialog = await screen.findByRole('dialog', { name: 'Create category rule' })
    // pattern pre-filled from the payee, processor prefix stripped
    expect((within(dialog).getByLabelText('Payee pattern') as HTMLInputElement).value).toBe(
      'pine state biscuits',
    )
    await user.type(within(dialog).getByLabelText('Category'), 'dining')
    const createBtn = within(dialog).getByRole('button', { name: 'Create rule' })
    expect((createBtn as HTMLButtonElement).type).toBe('submit')
    await user.click(createBtn)

    // apply-now (default checked) recategorizes both PINE STATE rows
    await waitFor(
      () => expect(screen.queryAllByRole('checkbox', { name: /Select TST\* PINE STATE/ })).toHaveLength(0),
      { timeout: 8000 },
    )
    // the new rule shows in the rules card
    expect(await screen.findByText('“pine state biscuits”')).toBeTruthy()
  }, 60000)
})

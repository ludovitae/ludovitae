/** Tracking (v1.3, #21): the plan-vs-actuals view, capture flow, metric
 * switcher, within-normal-range messaging, and the dashboard benchmark stat —
 * driven through real controls against the mock contract. */

// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

// This project does not auto-clean between tests (see scenario-studio.smoke);
// guarantee isolation even when an assertion throws mid-test.
afterEach(cleanup)

async function gotoTracking(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('link', { name: 'Tracking' }, { timeout: 8000 })
  await user.click(screen.getByRole('link', { name: 'Tracking' }))
  await screen.findByText('Saved plans', undefined, { timeout: 8000 })
}

describe('tracking view', () => {
  it('overlays the benchmark plan against actuals with a metric switcher', async () => {
    const user = userEvent.setup()
    render(<App />)
    await gotoTracking(user)

    // both demo snapshots are listed (the benchmark name also echoes in the
    // panel header, so it appears more than once — the revision is list-only).
    expect(screen.getAllByText('Baseline — spring check-in').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Retire at 55 — revision')).toBeTruthy()

    // real controls: the three metric tabs, net worth selected by default.
    const netTab = screen.getByRole('tab', { name: 'Net worth' })
    expect(netTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Spending' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Saving' })).toBeTruthy()

    // the plan-vs-actual overlay renders, and the model-honesty band note shows.
    await screen.findByRole('img', { name: /net worth plan versus actual/i }, { timeout: 8000 })
    // "normal range" shows in both the band legend and the model-honesty note.
    expect(screen.getAllByText(/normal range/i).length).toBeGreaterThanOrEqual(1)

    // switch to Saving: a band-less metric — no band legend, no p25/p75 note.
    await user.click(screen.getByRole('tab', { name: 'Saving' }))
    expect(screen.getByRole('tab', { name: 'Saving' }).getAttribute('aria-selected')).toBe('true')
    await screen.findByRole('img', { name: /saving plan versus actual/i }, { timeout: 8000 })
    await waitFor(() => expect(screen.queryAllByText(/normal range/i).length).toBe(0))

    cleanup()
  }, 30000)

  it('captures the current plan as a new snapshot', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('link', { name: 'Tracking' }, { timeout: 8000 }))
    await screen.findByText('Saved plans', undefined, { timeout: 8000 })

    // open the capture form, name it, capture.
    await user.click(screen.getByRole('button', { name: /capture current plan/i }))
    const input = await screen.findByLabelText('Snapshot name')
    await user.type(input, 'My mid-year check')
    await user.click(screen.getByRole('button', { name: 'Capture' }))

    // the new snapshot appears in the list.
    await screen.findByText('My mid-year check', undefined, { timeout: 8000 })

    cleanup()
  }, 30000)

  it('surfaces the benchmark delta on the dashboard, linking to Tracking', async () => {
    const user = userEvent.setup()
    render(<App />)
    // ensure we are on the dashboard regardless of prior router state.
    await user.click(await screen.findByRole('link', { name: 'Dashboard' }, { timeout: 8000 }))
    await screen.findByText('Net worth', undefined, { timeout: 8000 })

    const stat = await screen.findByRole('link', { name: /view plan tracking/i }, { timeout: 8000 })
    expect(within(stat).getByText('vs plan')).toBeTruthy()
    expect(stat.getAttribute('href')).toBe('/tracking')

    cleanup()
  }, 30000)
})

/** T-008 jsdom walk of the Spending hub tabs against the mock API. All
 * interactions through real controls (the type=submit lesson stands). */

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

describe('spending hub (mock API)', () => {
  it('walks Summary, Recurring, Hotspots and Forecast through the real tabs', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('link', { name: /Spending/ }, { timeout: 8000 }))

    // Plan is the default tab — the v1.1 view is intact.
    const tablist = await screen.findByRole('tablist', { name: 'Spending views' })
    expect(within(tablist).getByRole('tab', { name: 'Plan', selected: true })).toBeTruthy()
    await screen.findByText('Planned spending', undefined, { timeout: 8000 })

    // --- Summary: category × month heatmap ---
    await user.click(within(tablist).getByRole('tab', { name: 'Summary' }))
    const grid = await screen.findByRole('grid', { name: 'Spending by category and month' }, { timeout: 8000 })
    // labeled rows with per-cell aria values
    expect(within(grid).getByRole('rowheader', { name: 'groceries' })).toBeTruthy()
    expect(within(grid).getAllByRole('gridcell').length).toBeGreaterThan(50)
    // paired card payments must NOT appear as a category
    expect(within(grid).queryByRole('rowheader', { name: /payment/i })).toBeNull()
    // window selector is a real radiogroup
    await user.click(screen.getByRole('radio', { name: '6 mo' }))
    await screen.findByText(/across (6|7) months/, undefined, { timeout: 8000 })

    // --- Recurring: the subscription radar ---
    await user.click(within(tablist).getByRole('tab', { name: 'Recurring' }))
    await screen.findByText('Possibly forgotten', undefined, { timeout: 8000 })
    // forgotten hunters
    expect(screen.getAllByText('Apex Gym').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CloudVault Storage').length).toBeGreaterThan(0)
    // the price hike badge on Netflix
    expect(screen.getByText('Netflix')).toBeTruthy()
    expect(screen.getByText('+16.1%')).toBeTruthy()
    // lapsed group
    expect(screen.getByText('HBO Max')).toBeTruthy()
    expect(screen.getByText('Lapsed')).toBeTruthy()
    // stat row
    expect(screen.getByText('Monthly total')).toBeTruthy()

    // --- Hotspots ---
    await user.click(within(tablist).getByRole('tab', { name: 'Hotspots' }))
    await screen.findByText('Category spikes', undefined, { timeout: 8000 })
    expect(screen.getByText('dining')).toBeTruthy()
    expect(screen.getByText('Price increases')).toBeTruthy()
    expect(screen.getByText('Top merchants')).toBeTruthy()
    expect(screen.getAllByText('New Seasons Market').length).toBeGreaterThan(0)

    // --- Forecast ---
    await user.click(within(tablist).getByRole('tab', { name: 'Forecast' }))
    await screen.findByText('Next 12 months', undefined, { timeout: 8000 })
    expect(
      screen.getByRole('img', { name: 'Twelve-month spending forecast, recurring plus variable' }),
    ).toBeTruthy()
    // visible per-series stat line (the contrast-relief channel)
    expect(screen.getByText(/\/mo recurring \+/)).toBeTruthy()
    expect(screen.getByText('Variable spending, by category')).toBeTruthy()
  }, 60000)
})

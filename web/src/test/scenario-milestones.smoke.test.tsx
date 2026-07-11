/** T-006 milestone interaction: moving a claim-age slider re-simulates and
 * the milestone marker's label (an engine output) updates to the new claim
 * factor. Real controls throughout (see the type=submit lesson, fix 8194bc3). */

// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { api } from '@/api/client'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

describe('scenario studio milestones', () => {
  it('renders engine milestones and updates them when a claim-age slider moves', async () => {
    const simSpy = vi.spyOn(api, 'simulate')
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    await user.click(screen.getByRole('link', { name: 'Scenarios' }))
    await screen.findByText('Projected net worth', undefined, { timeout: 8000 })

    // Baseline markers on the chart: every member's timing, full labels via
    // each marker group's aria-label (native <title> serves pointer hover).
    await screen.findByLabelText('Brian claims Social Security (100% of FRA)', undefined, { timeout: 8000 })
    expect(screen.getByLabelText('Brian retires')).toBeTruthy()
    expect(screen.getByLabelText('Dana retires')).toBeTruthy()
    expect(screen.getByLabelText('Dana claims Social Security (100% of FRA)')).toBeTruthy()
    expect(screen.getByLabelText('RMDs begin for Brian')).toBeTruthy()
    expect(screen.getByLabelText('RMDs begin for Dana')).toBeTruthy()

    // The claim-age slider shows the live benefit factor while dragging.
    const slider = screen.getByLabelText('SS claim age — Brian') as HTMLInputElement
    expect(slider.getAttribute('aria-valuetext')).toBe('67 → 100%')
    fireEvent.change(slider, { target: { value: '62' } })
    expect(slider.getAttribute('aria-valuetext')).toBe('62 → 70%')

    // Debounced re-sim carries the member override…
    await waitFor(
      () => {
        const lastReq = simSpy.mock.calls.at(-1)?.[0] as {
          params?: { member_overrides?: Record<string, { ss_claim_age?: number }> }
        }
        expect(lastReq?.params?.member_overrides?.['1']?.ss_claim_age).toBe(62)
      },
      { timeout: 8000 },
    )

    // …and the milestone marker follows the engine output: new age + factor.
    await screen.findByLabelText('Brian claims Social Security (70% of FRA)', undefined, { timeout: 8000 })
    expect(screen.queryByLabelText('Brian claims Social Security (100% of FRA)')).toBeNull()
    // the untouched partner milestone is unchanged
    expect(screen.getByLabelText('Dana claims Social Security (100% of FRA)')).toBeTruthy()

    simSpy.mockRestore()
    cleanup()
  }, 40000)
})

/** T-003 scenario studio: dragging a slider must debounce to a SINGLE
 * re-simulation (coalescing intermediate values) and update the chart data,
 * per T-002's live-fan-chart acceptance criterion. */

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

function medianText(): string {
  // EndStat: <div><p>Median outcome</p><p class="num">$X.XM</p><p>…</p></div>
  return screen.getByText('Median outcome').parentElement!.textContent ?? ''
}

describe('scenario studio slider', () => {
  it('coalesces rapid slider changes into one re-sim and updates the chart', async () => {
    const simSpy = vi.spyOn(api, 'simulate')
    const user = userEvent.setup()
    render(<App />)

    // Dashboard first, then navigate into the studio.
    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    await user.click(screen.getByRole('link', { name: 'Scenarios' }))
    await screen.findByText('Projected net worth', undefined, { timeout: 8000 })
    await screen.findByRole('img', { name: /fan chart/i }, { timeout: 8000 })

    // Let the initial simulation settle so we count only slider-driven calls.
    const before = medianText()
    await new Promise((r) => setTimeout(r, 500))
    const callsBefore = simSpy.mock.calls.length

    // Two rapid changes on the self member's retirement-age slider; the 300ms
    // debounce should collapse them into a single re-simulation on the final
    // value. (v1.1: the studio writes member_overrides, keyed by member id.)
    const slider = screen.getByLabelText('Retirement age — Brian') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '60' } })
    fireEvent.change(slider, { target: { value: '55' } })

    // Chart data changes (median outcome differs from the baseline path).
    await waitFor(() => expect(medianText()).not.toBe(before), { timeout: 8000 })

    const newSimCalls = simSpy.mock.calls.length - callsBefore
    expect(newSimCalls).toBe(1)

    // The single re-sim ran on the settled value (self override → 55).
    const lastReq = simSpy.mock.calls.at(-1)![0] as {
      params?: { member_overrides?: Record<string, { retirement_age?: number }> }
    }
    expect(lastReq.params?.member_overrides?.['1']?.retirement_age).toBe(55)

    simSpy.mockRestore()
    cleanup()
  }, 30000)
})

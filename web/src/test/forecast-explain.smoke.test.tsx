/** #29 forecast honesty + the #31 interim saving explainer, walked through
 * real controls against the mock API. The explain panel's pinned values come
 * from the mock db's seeded charges (Netflix $17.99/mo monthly, Amazon Prime
 * $139 annual, HBO Max lapsed). */

// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import * as db from '@/api/mock/db'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

afterEach(cleanup)

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** First of the month, `delta` months from now — independent arithmetic so
 * the assertions don't just mirror the component's own helpers. */
function monthAt(delta: number): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + delta, 1)
}
const longName = (d: Date) => `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`

async function openTab(name: string) {
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('link', { name: /Spending/ }, { timeout: 8000 }))
  const tablist = await screen.findByRole('tablist', { name: 'Spending views' })
  await user.click(within(tablist).getByRole('tab', { name }))
  return user
}

describe('forecast "how this is computed" panel (#29)', () => {
  it('renders the joined recurring + window + projection facts from response data', async () => {
    const user = await openTab('Forecast')
    await screen.findByText('Next 12 months', undefined, { timeout: 8000 })

    // Collapsed by default, quiet chrome.
    const strip = await screen.findByRole('button', { name: /How this is computed/ }, { timeout: 8000 })
    expect(strip.getAttribute('aria-expanded')).toBe('false')
    await user.click(strip)
    expect(strip.getAttribute('aria-expanded')).toBe('true')

    // (a) recurring components — pin one steady row: Netflix, monthly, at its
    // monthly equivalent (mock seeds $17.99 post-hike).
    const recurringSection = screen.getByRole('region', { name: 'Recurring components' })
    const netflix = within(recurringSection).getByText('Netflix')
    expect(netflix.nextElementSibling?.textContent).toContain('monthly')
    expect(netflix.nextElementSibling?.textContent).toContain('$17.99')

    // Annual charge shows its anniversary month: Amazon Prime last charged
    // ~1 month ago on day 20 → anniversary = last month's calendar month.
    const prime = within(recurringSection).getByText('Amazon Prime')
    const anniversary = MONTHS_LONG[monthAt(-1).getMonth()]
    expect(prime.nextElementSibling?.textContent).toContain('$139')
    expect(prime.nextElementSibling?.textContent).toContain(`lands in ${anniversary}`)

    // Lapsed charges are excluded and said so — HBO Max never appears as a
    // component, only inside the exclusion note.
    expect(within(recurringSection).getByText(/lapsed/).textContent).toContain('HBO Max')
    expect(within(recurringSection).queryByRole('term', { name: 'HBO Max' })).toBeNull()

    // (b) variable derivation — the exact 6-full-month window in plain
    // language: first day of (current − 6) through last day of (current − 1).
    const from = monthAt(-6)
    const toMonth = monthAt(-1)
    const lastDay = new Date(toMonth.getFullYear(), toMonth.getMonth() + 1, 0).getDate()
    const variableSection = screen.getByRole('region', { name: 'Variable derivation' })
    expect(variableSection.textContent).toContain('last 6 full months')
    expect(variableSection.textContent).toContain(`${MONTHS_LONG[from.getMonth()]} 1, ${from.getFullYear()}`)
    expect(variableSection.textContent).toContain(
      `${MONTHS_LONG[toMonth.getMonth()]} ${lastDay}, ${toMonth.getFullYear()}`,
    )
    expect(variableSection.textContent).toContain('recurring payees above are excluded')

    // (c) projection vs the current partial month.
    const windowSection = screen.getByRole('region', { name: 'Projection window' })
    expect(windowSection.textContent).toContain(`starting ${longName(monthAt(1))}`)
    expect(windowSection.textContent).toContain(longName(monthAt(0)))
    expect(windowSection.textContent).toContain('still in progress')
  }, 60000)
})

describe('forecast per-month breakdown (#29)', () => {
  it('lists a selected month’s components through the real month chips', async () => {
    const user = await openTab('Forecast')
    await screen.findByText('Next 12 months', undefined, { timeout: 8000 })

    const chips = await screen.findByRole('radiogroup', { name: 'Breakdown month' }, { timeout: 8000 })
    const buttons = within(chips).getAllByRole('radio')
    expect(buttons).toHaveLength(12)
    expect(buttons[0]!.getAttribute('aria-checked')).toBe('true')

    // Amazon Prime's anniversary calendar month appears exactly once in the
    // 12 projected months — at index 10 (projection starts next month, the
    // anniversary is last month's month number: +12 months − 2).
    await user.click(buttons[10]!)
    const annualMonth = await screen.findByLabelText(`Components for ${longName(monthAt(11))}`)
    expect(within(annualMonth).getByText(/Amazon Prime/).textContent).toContain('annual charge lands this month')
    expect(within(annualMonth).getByText('$139.00')).toBeTruthy()
    // steady components + the variable line with top categories
    expect(within(annualMonth).getByText('Netflix')).toBeTruthy()
    expect(within(annualMonth).getByText(/^Variable/)).toBeTruthy()

    // A non-anniversary month carries no annual lump.
    await user.click(buttons[3]!)
    const plainMonth = await screen.findByLabelText(`Components for ${longName(monthAt(4))}`)
    expect(within(plainMonth).queryByText(/Amazon Prime/)).toBeNull()
    expect(within(plainMonth).getByText('Netflix')).toBeTruthy()
  }, 60000)
})

describe('plan tab saving explainer (#31 interim slice)', () => {
  it('lists contribution flows with their monthly sum and presets the flow form', async () => {
    const user = await openTab('Plan')
    await screen.findByText('Planned spending', undefined, { timeout: 8000 })

    // Mock seeds 4 contributions: 1800 + 580 + 350 + 1000 = $3,730/mo.
    const intro = await screen.findByText(
      /Saving in the simulation comes from contribution flows/,
      undefined,
      { timeout: 8000 },
    )
    expect(intro.textContent).toContain('$3,730')
    const explainer = intro.parentElement!
    expect(within(explainer).getByText('401(k) contributions')).toBeTruthy()
    expect(within(explainer).getByText('Roth IRA')).toBeTruthy()

    // The inline creation path opens the real flow form, kind preset.
    await user.click(within(explainer).getByRole('button', { name: /Add contribution flow/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Add flow' })
    expect((within(dialog).getByLabelText('Kind') as HTMLSelectElement).value).toBe('contribution')
    // contribution-specific destination field is present
    expect(within(dialog).getByLabelText('Into account')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  }, 60000)

  it('shows the honest empty state when no contribution flows exist', async () => {
    // Zero-contribution state via the sanctioned mock fixture: splice the
    // contributions out of the mock db; refetch-on-mount picks it up. (UI
    // deletion itself is covered by flow-form.smoke.test.tsx.)
    const saved = [...db.flows]
    try {
      db.flows.splice(0, db.flows.length, ...saved.filter((f) => f.kind !== 'contribution'))
      await openTab('Plan')
      await screen.findByText(
        'No contribution flows yet — the simulation currently assumes no ongoing saving.',
        undefined,
        { timeout: 8000 },
      )
      // The list rendering is gone; the creation path stays available.
      expect(screen.queryByText(/currently .*\/mo:/)).toBeNull()
      expect(screen.getByRole('button', { name: /Add contribution flow/ })).toBeTruthy()
    } finally {
      db.flows.splice(0, db.flows.length, ...saved)
    }
  }, 60000)
})

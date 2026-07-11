/** T-009 jsdom walk of the import wizard's first-mile features against the
 * mock API: sign-convention confirm step, preset save + auto-match + detach,
 * split debit/credit mapping. Real controls throughout. */

// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.setItem('gol.mock.authed', '1')
})

afterEach(cleanup)

const CARD_CSV = [
  'Date,Description,Amount',
  '06/02/2026,NEW SEASONS MARKET,84.12',
  '06/03/2026,CHEVRON,51.40',
  '06/05/2026,RISTRETTO ROASTERS,13.75',
  '06/08/2026,NETFLIX.COM,17.99',
  '06/11/2026,REI PORTLAND,129.95',
  '06/28/2026,PAYMENT - THANK YOU,-450.00',
].join('\n')

const SPLIT_CSV = [
  'Date,Description,Debit,Credit',
  '2026-06-01,ACME CORP PAYROLL,,4900.00',
  '2026-06-02,ROCKET MORTGAGE,2350.00,',
  '2026-06-09,NEW SEASONS MARKET,96.40,',
].join('\n')

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input
}

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(await screen.findByRole('link', { name: /Import/ }, { timeout: 8000 }))
  await screen.findByLabelText('Into account', undefined, { timeout: 8000 })
}

describe('import wizard first mile (mock API)', () => {
  it('flags a charges-positive card CSV, imports with flip, saves and rematches a preset', async () => {
    const user = userEvent.setup()
    await openImport(user)

    // into the credit card account
    await user.selectOptions(screen.getByLabelText('Into account'), 'Sapphire Card')
    await user.upload(fileInput(), new File([CARD_CSV], 'card.csv', { type: 'text/csv' }))

    // step 2 with the sign-convention confirm step, checkbox pre-checked
    await screen.findByText('Map the columns', undefined, { timeout: 8000 })
    expect(screen.getByText(/5 of 6 rows look like charges/)).toBeTruthy()
    const flip = screen.getByRole('checkbox', { name: 'Flip signs on import' }) as HTMLInputElement
    expect(flip.checked).toBe(true)

    // save the mapping as a preset on commit
    await user.type(screen.getByLabelText('Save this mapping as a preset'), 'Chase Test')
    await user.click(screen.getByRole('button', { name: 'Import transactions' }))
    await screen.findByText(/6 transactions imported into Sapphire Card/, undefined, {
      timeout: 8000,
    })

    // second upload of the same shape: the preset is recognized
    await user.click(screen.getByRole('button', { name: 'Import another file' }))
    await user.selectOptions(
      await screen.findByLabelText('Into account', undefined, { timeout: 8000 }),
      'Sapphire Card',
    )
    await user.upload(fileInput(), new File([CARD_CSV], 'card-again.csv', { type: 'text/csv' }))
    await screen.findByText(/Using your/, undefined, { timeout: 8000 })
    expect(screen.getByText('Chase Test')).toBeTruthy()
    // preset carries the sign flip
    expect(
      (screen.getByRole('checkbox', { name: 'Flip signs on import' }) as HTMLInputElement).checked,
    ).toBe(true)

    // detach: back to the suggestion, banner gone
    await user.click(screen.getByRole('button', { name: 'Don’t use the preset' }))
    expect(screen.queryByText(/Using your/)).toBeNull()

    // committing again dedupes everything
    await user.click(screen.getByRole('button', { name: 'Import transactions' }))
    await screen.findByText(/0 transactions imported/, undefined, { timeout: 8000 })
    expect(screen.getByText(/6 duplicates recognized and skipped/)).toBeTruthy()
  }, 60000)

  it('maps split debit/credit columns and imports them signed', async () => {
    const user = userEvent.setup()
    await openImport(user)

    await user.selectOptions(screen.getByLabelText('Into account'), 'Everyday Checking')
    await user.upload(fileInput(), new File([SPLIT_CSV], 'bank.csv', { type: 'text/csv' }))

    await screen.findByText('Map the columns', undefined, { timeout: 8000 })
    // suggested mapping detected the split — the toggle is on, both selects set
    const toggle = screen.getByRole('switch', { name: 'Separate debit and credit columns' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText('Debit (money out)') as HTMLSelectElement).value).toBe('Debit')
    expect((screen.getByLabelText('Credit (money in)') as HTMLSelectElement).value).toBe('Credit')
    // no sign hint for explicit-sign exports
    expect(screen.queryByRole('checkbox', { name: 'Flip signs on import' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Import transactions' }))
    await screen.findByText(/3 transactions imported into Everyday Checking/, undefined, {
      timeout: 8000,
    })
  }, 40000)
})

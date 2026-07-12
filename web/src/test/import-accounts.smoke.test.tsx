/** #26 jsdom walk of the wizard's account matching & creation against the
 * mock API: OFX unknown-id → create-new mini-form → link → auto-match on the
 * next upload; multi-account CSV → per-group mapping step → per-account
 * result. Real controls throughout. */

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

const OFX = [
  'OFXHEADER:100',
  '',
  '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>',
  '<BANKACCTFROM><ACCTID>90926011</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>',
  '<BANKTRANLIST>',
  '<STMTTRN><DTPOSTED>20260601</DTPOSTED><TRNAMT>-42.50</TRNAMT><NAME>COFFEE SHOP</NAME></STMTTRN>',
  '<STMTTRN><DTPOSTED>20260610</DTPOSTED><TRNAMT>1250.00</TRNAMT><NAME>PAYROLL</NAME></STMTTRN>',
  '</BANKTRANLIST>',
  '<LEDGERBAL><BALAMT>900.00</BALAMT></LEDGERBAL>',
  '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
].join('\n')

const MULTI_CSV = [
  'Date,Account,Account Number,Description,Amount',
  '2026-06-01,Roth IRA,111222,BUY INDEX FUND,-100.00',
  '2026-06-02,Roth IRA,111222,DIVIDEND,5.00',
  '2026-06-03,Taxable Brokerage,333444,BUY INDEX FUND,-200.00',
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

describe('import wizard account matching (#26, mock API)', () => {
  it('OFX: unknown id offers create-new, links it, and auto-matches next time', async () => {
    const user = userEvent.setup()
    await openImport(user)

    await user.upload(fileInput(), new File([OFX], 'statement.ofx', { type: 'application/x-ofx' }))
    await screen.findByText('OFX file recognized', undefined, { timeout: 8000 })

    // unknown id → the not-linked-yet notice
    expect(screen.getByText(/isn’t linked yet/)).toBeTruthy()

    // switch the target to a brand-new account via the inline mini-form
    await user.selectOptions(screen.getByLabelText('Into account'), '＋ Create new account…')
    const name = screen.getByLabelText('New account name')
    await user.clear(name)
    await user.type(name, 'First National Checking')
    // OFX message set guessed the type
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('checking')

    await user.click(screen.getByRole('button', { name: 'Import transactions' }))
    await screen.findByText(/2 transactions imported into First National Checking/, undefined, {
      timeout: 8000,
    })
    expect(screen.getByText(/created and linked/)).toBeTruthy()

    // second upload: the hashed id now matches the created account
    await user.click(screen.getByRole('button', { name: 'Import another file' }))
    await screen.findByLabelText('Into account', undefined, { timeout: 8000 })
    await user.upload(fileInput(), new File([OFX], 'statement2.ofx', { type: 'application/x-ofx' }))
    // the banner renders immediately; its account name fills in once the
    // accounts list refetch (invalidated by the create-commit) lands
    await screen.findByText(/Matched ···6011/, undefined, { timeout: 8000 })
    await waitFor(
      () =>
        expect(screen.getByText(/Matched ···6011/).textContent).toContain(
          'First National Checking',
        ),
      { timeout: 8000 },
    )

    // committing to the matched account dedupes everything
    await user.click(screen.getByRole('button', { name: 'Import transactions' }))
    await screen.findByText(/0 transactions imported/, undefined, { timeout: 8000 })
    expect(screen.getByText(/2 duplicates recognized and skipped/)).toBeTruthy()
  }, 60000)

  it('multi-account CSV: per-group mapping step creates unseen accounts', async () => {
    const user = userEvent.setup()
    await openImport(user)

    await user.upload(fileInput(), new File([MULTI_CSV], 'brokerage.csv', { type: 'text/csv' }))
    await screen.findByText('Accounts in this file', undefined, { timeout: 8000 })

    // both groups default to create-new with prefilled names + guessed types
    const rothName = screen.getByLabelText('New account name for ···1222') as HTMLInputElement
    expect(rothName.value).toBe('Roth IRA')
    expect((screen.getByLabelText('New account type for ···1222') as HTMLSelectElement).value).toBe(
      'retirement',
    )
    expect(
      (screen.getByLabelText('New account type for ···3444') as HTMLSelectElement).value,
    ).toBe('brokerage')

    await user.click(screen.getByRole('button', { name: 'Import transactions' }))
    await screen.findByText(/3 transactions imported into multiple accounts/, undefined, {
      timeout: 8000,
    })
    // per-account breakdown with "new" badges
    const rothRow = screen.getByText('Roth IRA').closest('li')!
    expect(within(rothRow).getByText('new')).toBeTruthy()
    expect(within(rothRow).getByText(/2 imported/)).toBeTruthy()
    const brokerageRow = screen.getByText('Taxable Brokerage').closest('li')!
    expect(within(brokerageRow).getByText(/1 imported/)).toBeTruthy()
  }, 60000)
})

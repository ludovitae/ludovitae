/** First-run smoke: no password → setup screen → create & unlock → dashboard.
 *
 * Regression coverage for the type="submit" bug: the flow must work by
 * CLICKING the real button, not by firing submit on the form — a Button that
 * renders type="button" breaks users but passes form-level submit tests.
 */

// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '@/App'

beforeAll(() => {
  localStorage.removeItem('gol.mock.password')
  localStorage.removeItem('gol.mock.authed')
})

describe('first-run smoke', () => {
  it('sets a password via the button and lands on the dashboard', async () => {
    render(<App />)
    await screen.findByText(/set your password/i, undefined, { timeout: 8000 })

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'play the long game' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'play the long game' },
    })

    const button = screen.getByRole('button', { name: 'Create & unlock' })
    expect(button).toHaveProperty('type', 'submit')
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)

    // Mock API accepts the password and authenticates; App routes to /.
    await screen.findByText('Net worth', undefined, { timeout: 8000 })
    cleanup()
  }, 30000)
})

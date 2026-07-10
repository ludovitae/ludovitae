/** First-run smoke: no password → setup screen. */

// @vitest-environment jsdom

import { beforeAll, describe, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '@/App'

beforeAll(() => {
  localStorage.removeItem('gol.mock.password')
  localStorage.removeItem('gol.mock.authed')
})

describe('first-run smoke', () => {
  it('routes to setup when no password exists', async () => {
    render(<App />)
    await screen.findByText(/set your password/i, undefined, { timeout: 8000 })
    cleanup()
  }, 30000)
})

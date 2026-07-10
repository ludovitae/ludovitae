/** Auth routing smoke: locked → login screen. Own file for a fresh module
 * registry (App's router/queryClient are module singletons). */

// @vitest-environment jsdom

import { beforeAll, describe, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '@/App'

beforeAll(() => {
  localStorage.setItem('gol.mock.password', 'demo-password-123')
  localStorage.removeItem('gol.mock.authed')
})

describe('auth smoke', () => {
  it('routes to login when locked', async () => {
    render(<App />)
    await screen.findByLabelText('Password', undefined, { timeout: 8000 })
    await screen.findByRole('button', { name: 'Unlock' }, { timeout: 8000 })
    cleanup()
  }, 30000)
})

/** T-011b engine-version tracking: surface a change once per version pair,
 * never again after dismissal, and record a fresh browser's first version
 * silently (there is no "before" to explain). */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { checkEngineVersion, dismissEngineChange } from './engineVersion'

describe('checkEngineVersion', () => {
  beforeEach(() => localStorage.clear())

  it('records the first version silently', () => {
    expect(checkEngineVersion('2')).toBeNull()
    expect(localStorage.getItem('gol.engine.lastSeen')).toBe('2')
  })

  it('returns the pending change when the version moves', () => {
    localStorage.setItem('gol.engine.lastSeen', '1')
    expect(checkEngineVersion('2')).toEqual({ from: '1', to: '2' })
    // Undismissed: still pending on the next check (viewing does not retire it).
    expect(checkEngineVersion('2')).toEqual({ from: '1', to: '2' })
  })

  it('never resurfaces a dismissed version pair', () => {
    localStorage.setItem('gol.engine.lastSeen', '1')
    const change = checkEngineVersion('2')!
    dismissEngineChange(change)
    expect(checkEngineVersion('2')).toBeNull()
    expect(localStorage.getItem('gol.engine.lastSeen')).toBe('2')
  })

  it('dismissal is per pair — a later change still surfaces', () => {
    localStorage.setItem('gol.engine.lastSeen', '1')
    dismissEngineChange({ from: '1', to: '2' })
    expect(checkEngineVersion('3')).toEqual({ from: '2', to: '3' })
  })

  it('same version stays quiet', () => {
    localStorage.setItem('gol.engine.lastSeen', '2')
    expect(checkEngineVersion('2')).toBeNull()
  })

  it('survives corrupted dismissal storage', () => {
    localStorage.setItem('gol.engine.lastSeen', '1')
    localStorage.setItem('gol.engine.dismissed', 'not json')
    expect(checkEngineVersion('2')).toEqual({ from: '1', to: '2' })
  })
})

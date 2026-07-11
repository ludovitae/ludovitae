/** T-011b "what moved" — remembers the last engine version this browser has
 * seen so behavior changes surface exactly once as an inline note, and never
 * again once dismissed (DESIGN.md attention economics: actionable-once per
 * version pair, no badge, no standing banner).
 *
 * Dev/test: simulate an engine upgrade by setting
 * `localStorage.setItem('gol.engine.lastSeen', '1')` in the console before
 * loading the studio — the next engine-v2 response surfaces the note.
 */

/** The engine version the app is built against — kept in lockstep with the
 * server's `gol.ENGINE_VERSION`. The VITE_MOCK fixtures are generated from that
 * same engine; a vitest guard asserts the committed fixtures still carry this
 * version, so a server-side engine bump can't ship stale mock goldens. */
export const ENGINE_VERSION = '3'

const LAST_SEEN_KEY = 'gol.engine.lastSeen'
const DISMISSED_KEY = 'gol.engine.dismissed'

export interface EngineChange {
  from: string
  to: string
}

const pairKey = (c: EngineChange) => `${c.from}->${c.to}`

function dismissedPairs(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/** Feed every simulation response's engine_version through this. Returns the
 * pending change to surface, or null. The first version ever seen is
 * recorded silently — a fresh browser has no "before" to explain. */
export function checkEngineVersion(current: string): EngineChange | null {
  const last = localStorage.getItem(LAST_SEEN_KEY)
  if (last === null || last === current) {
    localStorage.setItem(LAST_SEEN_KEY, current)
    return null
  }
  const change: EngineChange = { from: last, to: current }
  if (dismissedPairs().includes(pairKey(change))) {
    localStorage.setItem(LAST_SEEN_KEY, current)
    return null
  }
  // Not yet dismissed: leave lastSeen at `from` so the note re-surfaces until
  // acknowledged — dismissal, not viewing, is what retires it.
  return change
}

/** Dismiss = never show this version pair again. */
export function dismissEngineChange(change: EngineChange): void {
  const pairs = dismissedPairs()
  if (!pairs.includes(pairKey(change))) pairs.push(pairKey(change))
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(pairs))
  localStorage.setItem(LAST_SEEN_KEY, change.to)
}

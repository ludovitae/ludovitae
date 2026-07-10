/** Scenario params helpers: canonical cleaning + stable serialization.
 * A scenario is a diff against the baseline — only meaningful keys survive. */

import type { ScenarioEvent, ScenarioParams } from '@/api/types'

/** Drop no-op keys so params stay a minimal diff against baseline. */
export function cleanParams(params: ScenarioParams): ScenarioParams {
  const out: ScenarioParams = {}
  if (params.retirement_age !== undefined) out.retirement_age = params.retirement_age
  if (params.monthly_savings_delta !== undefined && params.monthly_savings_delta !== 0)
    out.monthly_savings_delta = params.monthly_savings_delta
  if (params.annual_retirement_spending !== undefined)
    out.annual_retirement_spending = params.annual_retirement_spending
  if (params.return_override_pct !== undefined && params.return_override_pct !== null)
    out.return_override_pct = params.return_override_pct
  if (params.inflation_override_pct !== undefined && params.inflation_override_pct !== null)
    out.inflation_override_pct = params.inflation_override_pct
  if (params.events && params.events.length > 0) out.events = params.events.map(cleanEvent)
  return out
}

function cleanEvent(e: ScenarioEvent): ScenarioEvent {
  const base = { name: e.name, kind: e.kind }
  // one_time.amount is signed (positive = money in); recurring amounts are
  // positive magnitudes with direction implied by kind (ruling 2026-07-10).
  if (e.kind === 'one_time') return { ...base, amount: e.amount ?? 0, age: e.age ?? 0 }
  return {
    ...base,
    amount_monthly: Math.abs(e.amount_monthly ?? 0),
    start_age: e.start_age ?? 0,
    end_age: e.end_age ?? null,
  }
}

/** Deterministic serialization (sorted keys) — stable query-cache keys. */
export function serializeParams(params: ScenarioParams): string {
  return stableStringify(cleanParams(params))
}

export function paramsEqual(a: ScenarioParams, b: ScenarioParams): boolean {
  return serializeParams(a) === serializeParams(b)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as object).sort()
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  )
  return `{${parts.join(',')}}`
}

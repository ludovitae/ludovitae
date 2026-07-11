/** Scenario params helpers: canonical cleaning + stable serialization.
 * A scenario is a diff against the baseline — only meaningful keys survive. */

import type { MemberOverride, ScenarioEvent, ScenarioParams } from '@/api/types'

/** Drop no-op keys so params stay a minimal diff against baseline. */
export function cleanParams(params: ScenarioParams): ScenarioParams {
  const out: ScenarioParams = {}
  if (params.retirement_age !== undefined) out.retirement_age = params.retirement_age
  const mo = cleanMemberOverrides(params.member_overrides)
  if (mo) out.member_overrides = mo
  if (params.monthly_savings_delta !== undefined && params.monthly_savings_delta !== 0)
    out.monthly_savings_delta = params.monthly_savings_delta
  if (params.annual_retirement_spending !== undefined)
    out.annual_retirement_spending = params.annual_retirement_spending
  if (params.spending_delta_pct !== undefined && params.spending_delta_pct !== 0)
    out.spending_delta_pct = params.spending_delta_pct
  if (params.return_override_pct !== undefined && params.return_override_pct !== null)
    out.return_override_pct = params.return_override_pct
  if (params.inflation_override_pct !== undefined && params.inflation_override_pct !== null)
    out.inflation_override_pct = params.inflation_override_pct
  if (params.events && params.events.length > 0) out.events = params.events.map(cleanEvent)
  return out
}

/** Keys are member ids as strings (JSON object keys, docs/API.md v1.1);
 * empty override objects are pruned. Returns undefined when nothing survives. */
function cleanMemberOverrides(
  mo: ScenarioParams['member_overrides'],
): Record<string, MemberOverride> | undefined {
  if (!mo) return undefined
  const out: Record<string, MemberOverride> = {}
  for (const [id, ov] of Object.entries(mo)) {
    if (!ov) continue
    const clean: MemberOverride = {}
    if (ov.retirement_age !== undefined) clean.retirement_age = ov.retirement_age
    if (ov.ss_claim_age !== undefined) clean.ss_claim_age = ov.ss_claim_age
    if (Object.keys(clean).length > 0) out[String(id)] = clean
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** The value a member's timing slider should show: explicit override wins,
 * then (for `self` retirement) the legacy top-level sugar, then the member's
 * own baseline. */
export function effectiveMemberTiming(
  params: ScenarioParams,
  memberId: number,
  key: keyof MemberOverride,
  baseline: number | null,
  isSelf: boolean,
): number | null {
  const ov = params.member_overrides?.[String(memberId)]?.[key]
  if (ov !== undefined) return ov
  if (isSelf && key === 'retirement_age' && params.retirement_age !== undefined)
    return params.retirement_age
  return baseline
}

/** Set (or clear, when back at the member's baseline) a per-member timing
 * override. Legacy scenarios that carry top-level `retirement_age` (v1 sugar
 * for `self`) are updated in place so their param shape stays stable. */
export function withMemberOverride(
  params: ScenarioParams,
  memberId: number,
  key: keyof MemberOverride,
  value: number,
  baseline: number | null,
  isSelf: boolean,
): ScenarioParams {
  const out: ScenarioParams = { ...params }

  // Legacy path: keep editing the top-level sugar if that's where the self
  // member's retirement age already lives (and no override shadows it).
  if (
    isSelf &&
    key === 'retirement_age' &&
    out.retirement_age !== undefined &&
    out.member_overrides?.[String(memberId)]?.retirement_age === undefined
  ) {
    if (value === baseline) delete out.retirement_age
    else out.retirement_age = value
    return out
  }

  const mo: Record<string, MemberOverride> = { ...out.member_overrides }
  const k = String(memberId)
  const ov: MemberOverride = { ...mo[k] }
  if (value === baseline) delete ov[key]
  else ov[key] = value
  if (Object.keys(ov).length > 0) mo[k] = ov
  else delete mo[k]
  if (Object.keys(mo).length > 0) out.member_overrides = mo
  else delete out.member_overrides
  // The override supersedes the legacy sugar — never leave both in conflict.
  if (isSelf && key === 'retirement_age') delete out.retirement_age
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

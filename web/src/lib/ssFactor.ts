/** Social Security claim-age factors per docs/API.md v1.1: the benefit is the
 * FRA amount scaled by standard actuarial factors — 62→0.70 … 67→1.00 … 70→1.24,
 * per-year linear steps, FRA fixed at 67. */

export const SS_FRA = 67
export const SS_CLAIM_MIN = 62
export const SS_CLAIM_MAX = 70

/** Benefit multiplier for a claim age (clamped to 62–70). Exact at the
 * integer steps: 62→0.70, 67→1.00, 70→1.24. */
export function ssClaimFactor(claimAge: number): number {
  const a = Math.min(SS_CLAIM_MAX, Math.max(SS_CLAIM_MIN, claimAge))
  // integer math over percent to avoid float drift at the published steps
  return a <= SS_FRA ? (70 + 6 * (a - SS_CLAIM_MIN)) / 100 : (100 + 8 * (a - SS_FRA)) / 100
}

/** "62 → 70% of full benefit" — live readout for the claim-age slider. */
export function formatClaimFactor(claimAge: number): string {
  return `${claimAge} → ${Math.round(ssClaimFactor(claimAge) * 100)}% of full benefit`
}

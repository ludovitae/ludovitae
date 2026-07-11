/** Turn a raw bank-feed payee into a sensible starting `contains` pattern
 * for a category rule: lowercase, processor prefixes (SQ *, TST*, PAYPAL *…)
 * stripped, trailing reference codes dropped. Always editable in the modal —
 * this is a head start, not a guess we hide. */

const PROCESSOR_PREFIX = /^(sq|tst|py|pp|paypal)\s*\*\s*/i

export function payeeRulePattern(payee: string): string {
  const stripped = payee.trim().toLowerCase().replace(PROCESSOR_PREFIX, '')
  const tokens = stripped.split(/[\s*#]+/).filter(Boolean)
  // drop trailing store/reference codes (any token containing a digit)
  while (tokens.length > 1 && /\d/.test(tokens[tokens.length - 1]!)) tokens.pop()
  return tokens.join(' ') || payee.trim().toLowerCase()
}

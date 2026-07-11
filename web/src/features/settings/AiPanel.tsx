/** Settings → AI panel (v1.2). Spend governance ships BEFORE any AI call
 * exists (owner decision): key storage (write-only, last4 chip, clear),
 * a disabled enable-toggle that explains the stub, the monthly budget
 * governor with its hard-stop meter, this-month spend/tokens, and the
 * usage-by-month ledger. */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAiSettings, useAiUsage, useUpdateAiSettings } from '@/api/queries'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { Field, TextInput, Toggle } from '@/components/Field'
import { Skeleton } from '@/components/Skeleton'
import { IconCheck, IconLock, IconSparkle } from '@/components/icons'
import { formatMoney, formatMonthYear } from '@/lib/format'

export function AiPanel() {
  const settings = useAiSettings()
  const usage = useAiUsage(6)
  const update = useUpdateAiSettings()

  const [keyDraft, setKeyDraft] = useState('')
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState(false)

  const data = settings.data
  useEffect(() => {
    if (data && budgetDraft === null) setBudgetDraft(String(data.monthly_budget_usd))
  }, [data, budgetDraft])

  if (settings.isPending || !data) return <Skeleton className="h-96" />

  const budgetNum = Number((budgetDraft ?? '').replace(/[$,\s]/g, ''))
  const budgetValid = Number.isFinite(budgetNum) && budgetNum >= 0
  const budgetDirty = budgetValid && budgetNum !== data.monthly_budget_usd
  const spendPct =
    data.monthly_budget_usd > 0
      ? Math.min(100, (data.spend_this_month_usd / data.monthly_budget_usd) * 100)
      : 0

  function saveKey(e: FormEvent) {
    e.preventDefault()
    if (keyDraft.trim() === '' || update.isPending) return
    update.mutate([{ api_key: keyDraft.trim() }], { onSuccess: () => setKeyDraft('') })
  }

  function clearKey() {
    update.mutate([{ api_key: null }])
  }

  function saveBudget(e: FormEvent) {
    e.preventDefault()
    if (!budgetDirty || update.isPending) return
    update.mutate([{ monthly_budget_usd: budgetNum }], {
      onSuccess: () => {
        setSavedTick(true)
        setTimeout(() => setSavedTick(false), 1600)
      },
    })
  }

  return (
    <Card>
      <CardHeader
        title="AI assistance"
        hint="Spend governance ships first — add a key and cap it before any call is ever made"
      />
      <div className="flex flex-col gap-5 px-5 pt-2 pb-5">
        {/* enable toggle — deliberately disabled while the backend is stubbed */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <IconSparkle width={15} height={15} className="text-accent" />
              AI categorization
            </p>
            <p className="mt-0.5 max-w-md text-xs leading-relaxed text-ink-3">
              Coming soon — categorization runs on local rules and heuristics for now. Nothing
              leaves this machine. When it ships, it flips on here and every call is metered
              against the budget below.
            </p>
          </div>
          <Toggle checked={data.enabled} onChange={() => {}} label="Enable AI categorization" disabled />
        </div>

        {/* API key: write-only */}
        <div className="border-t border-edge pt-4">
          <p className="mb-2 text-xs font-medium text-ink-2">Claude API key</p>
          {data.has_api_key ? (
            <div className="flex items-center gap-2">
              <span className="num inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink">
                <IconLock width={13} height={13} className="text-ink-3" />
                •••• {data.api_key_last4}
              </span>
              <Button variant="danger" size="sm" onClick={clearKey} disabled={update.isPending}>
                Clear key
              </Button>
            </div>
          ) : (
            <form onSubmit={saveKey} className="flex items-end gap-2">
              <div className="max-w-xs flex-1">
                <TextInput
                  type="password"
                  autoComplete="off"
                  aria-label="Claude API key"
                  placeholder="sk-ant-…"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
              </div>
              <Button variant="primary" size="sm" type="submit" disabled={keyDraft.trim() === '' || update.isPending}>
                Save key
              </Button>
            </form>
          )}
          <p className="mt-1.5 text-[11px] text-ink-3">
            Write-only: stored in the local database, never shown again — only the last four
            characters identify it.
          </p>
        </div>

        {/* budget governor */}
        <div className="rounded-(--radius-s) border border-edge bg-surface-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Monthly budget (USD)" hint="Hard stop — a call that would exceed it is refused, not warned about">
              {(id) => (
                <form onSubmit={saveBudget} className="flex items-center gap-2">
                  <TextInput
                    id={id}
                    inputMode="decimal"
                    className="num w-28"
                    value={budgetDraft ?? ''}
                    onChange={(e) => setBudgetDraft(e.target.value)}
                  />
                  <Button variant="subtle" size="sm" type="submit" disabled={!budgetDirty || update.isPending}>
                    Set budget
                  </Button>
                  {savedTick ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-positive">
                      <IconCheck width={14} height={14} /> Saved
                    </span>
                  ) : null}
                </form>
              )}
            </Field>
            <div className="flex gap-8">
              <div>
                <p className="text-xs font-medium text-ink-3">Spent this month</p>
                <p className="num mt-0.5 text-lg font-semibold text-ink">
                  {formatMoney(data.spend_this_month_usd, { cents: true })}
                  <span className="text-[12px] font-normal text-ink-3">
                    {' '}
                    of {formatMoney(data.monthly_budget_usd, { cents: true })}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-3">Tokens this month</p>
                <p className="num mt-0.5 text-lg font-semibold text-ink">
                  {data.tokens_this_month.input.toLocaleString()}
                  <span className="text-[12px] font-normal text-ink-3"> in · </span>
                  {data.tokens_this_month.output.toLocaleString()}
                  <span className="text-[12px] font-normal text-ink-3"> out</span>
                </p>
              </div>
            </div>
          </div>
          {/* meter: fill on a lighter step of the same ramp */}
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-accent-soft"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={data.monthly_budget_usd}
            aria-valuenow={data.spend_this_month_usd}
            aria-label="AI spend this month against budget"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-(--ease-out)"
              style={{ width: `${spendPct.toFixed(1)}%` }}
            />
          </div>
        </div>

        {/* usage ledger */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-2">Usage by month</p>
          {usage.isPending ? (
            <Skeleton className="h-28" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs text-ink-3">
                  <th className="py-1.5 pr-4 font-medium">Month</th>
                  <th className="num py-1.5 pr-4 text-right font-medium">Input tokens</th>
                  <th className="num py-1.5 pr-4 text-right font-medium">Output tokens</th>
                  <th className="num py-1.5 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {(usage.data ?? []).map((u) => (
                  <tr key={u.month} className="border-b border-(--border) last:border-0">
                    <td className="py-1.5 pr-4 text-[13px] text-ink-2">{formatMonthYear(`${u.month}-01`)}</td>
                    <td className="num py-1.5 pr-4 text-right text-[13px] text-ink">
                      {u.input_tokens.toLocaleString()}
                    </td>
                    <td className="num py-1.5 pr-4 text-right text-[13px] text-ink">
                      {u.output_tokens.toLocaleString()}
                    </td>
                    <td className="num py-1.5 text-right text-[13px] text-ink">
                      {formatMoney(u.est_cost_usd, { cents: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-1.5 text-[11px] text-ink-3">
            Every future AI call writes a ledger row before it runs — the table stays truthful even
            at zero.
          </p>
        </div>
      </div>
    </Card>
  )
}

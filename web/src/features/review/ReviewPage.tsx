/** Review page (v1.2): the two human-in-the-loop queues.
 *
 * 1. Transfer candidates — near-miss pairs the importer wouldn't auto-link;
 *    both legs side-by-side (account, date, amount), confirm or dismiss.
 *    Dismiss is CLIENT-SIDE only (session state): the contract has no
 *    dismiss endpoint — flagged in the task log for T-007.
 * 2. Uncategorized transactions — bulk select + categorize, heuristic
 *    suggestions as one-click chips, and a create-rule-from-payee shortcut
 *    (pre-filled modal). A compact rules card closes the loop. */

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  useAccounts,
  useApplyRules,
  useCategorizeTransactions,
  useCreateRule,
  useDeleteRule,
  usePairTransfers,
  useRules,
  useSpending,
  useTransferCandidates,
  useUncategorized,
} from '@/api/queries'
import { api } from '@/api/client'
import type { CategorySuggestion, Transaction, TransferCandidate } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Field, Select, TextInput } from '@/components/Field'
import { Modal } from '@/components/Overlay'
import { Skeleton } from '@/components/Skeleton'
import { IconCheck, IconSwap, IconSparkle } from '@/components/icons'
import { formatDate, formatMoney } from '@/lib/format'
import { payeeRulePattern } from '@/lib/payee'
import { PageHeader } from '@/layout/AppShell'

export function ReviewPage() {
  return (
    <>
      <PageHeader
        title="Review"
        hint="Things the importer wasn’t sure about — pair the transfers, name the spending"
      />
      <div className="flex flex-col gap-4">
        <TransferQueue />
        <UncategorizedQueue />
        <RulesCard />
      </div>
    </>
  )
}

/* --------------------------- transfer candidates -------------------------- */

function TransferQueue() {
  const candidates = useTransferCandidates()
  const { data: accounts } = useAccounts()
  const pair = usePairTransfers()
  // Dismissal is session-local: no contract endpoint exists (flagged for T-007).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const accountName = useMemo(() => {
    const map = new Map((accounts ?? []).map((a) => [a.id, a.name]))
    return (id: number) => map.get(id) ?? `Account ${id}`
  }, [accounts])

  if (candidates.isPending) return <Skeleton className="h-48" />

  const visible = (candidates.data ?? []).filter(
    (c) => !dismissed.has(candidateKey(c)),
  )

  return (
    <Card>
      <CardHeader
        title="Transfer candidates"
        hint="Near-miss matches — confirmed pairs vanish from spending analytics"
      />
      {visible.length === 0 ? (
        <EmptyState
          illustration="flag"
          title="No transfers waiting"
          hint="Confident matches pair themselves on import; anything ambiguous lands here for a human call."
        />
      ) : (
        <ul className="flex flex-col gap-3 px-5 pt-2 pb-5">
          {visible.map((c) => (
            <li
              key={candidateKey(c)}
              className="rounded-(--radius-s) border border-edge bg-surface-3 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="num rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                  {Math.round(c.score * 100)}% match
                </span>
                <div className="flex gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={pair.isPending}
                    onClick={() => pair.mutate([[c.txns[0].id, c.txns[1].id]])}
                    aria-label={`Pair ${c.txns[0].payee} with ${c.txns[1].payee} as a transfer`}
                  >
                    <IconSwap width={15} height={15} /> Pair as transfer
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDismissed((d) => new Set(d).add(candidateKey(c)))
                    }
                    aria-label={`Dismiss candidate ${c.txns[0].payee}`}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CandidateLeg txn={c.txns[0]} account={accountName(c.txns[0].account_id)} />
                <CandidateLeg txn={c.txns[1]} account={accountName(c.txns[1].account_id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function candidateKey(c: TransferCandidate): string {
  return `${c.txns[0].id}:${c.txns[1].id}`
}

function CandidateLeg({ txn, account }: { txn: Transaction; account: string }) {
  const out = txn.amount < 0
  return (
    <div className="rounded-(--radius-s) border border-edge bg-surface px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-ink">{account}</p>
        <p className={`num shrink-0 text-[13px] font-semibold ${out ? 'text-negative' : 'text-positive'}`}>
          {out ? '−' : '+'}
          {formatMoney(Math.abs(txn.amount), { cents: true })}
        </p>
      </div>
      <p className="truncate text-[11px] text-ink-3">
        {formatDate(txn.date)} · {txn.payee}
      </p>
    </div>
  )
}

/* ------------------------- uncategorized queue ---------------------------- */

function UncategorizedQueue() {
  const uncategorized = useUncategorized()
  const { data: accounts } = useAccounts()
  const { data: spending } = useSpending()
  const categorize = useCategorizeTransactions()

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [category, setCategory] = useState('')
  const [suggestions, setSuggestions] = useState<Map<string, CategorySuggestion> | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [ruleFor, setRuleFor] = useState<Transaction | null>(null)

  const accountName = useMemo(() => {
    const map = new Map((accounts ?? []).map((a) => [a.id, a.name]))
    return (id: number) => map.get(id) ?? `Account ${id}`
  }, [accounts])

  const rows = uncategorized.data ?? []
  const knownCategories = useMemo(() => {
    const names = new Set<string>()
    for (const c of spending?.categories ?? []) names.add(c.name.toLowerCase())
    for (const s of suggestions?.values() ?? []) names.add(s.category)
    return [...names].sort()
  }, [spending, suggestions])

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))
  }

  function applyBulk(e: FormEvent) {
    e.preventDefault()
    const cat = category.trim().toLowerCase()
    if (!cat || selected.size === 0 || categorize.isPending) return
    categorize.mutate([[...selected], cat], {
      onSuccess: () => {
        setSelected(new Set())
        setCategory('')
      },
    })
  }

  async function suggest() {
    if (suggesting) return
    setSuggesting(true)
    try {
      const payees = [...new Set(rows.map((r) => r.payee))]
      const res = await api.categorize.suggest(payees)
      setSuggestions(new Map(res.suggestions.map((s) => [s.payee, s])))
    } finally {
      setSuggesting(false)
    }
  }

  if (uncategorized.isPending) return <Skeleton className="h-64" />

  return (
    <Card>
      <CardHeader
        title="Uncategorized transactions"
        hint="Name them here, or teach a rule so the next import names itself"
        action={
          rows.length > 0 ? (
            <Button variant="subtle" size="sm" onClick={() => void suggest()} disabled={suggesting}>
              <IconSparkle width={15} height={15} />
              {suggesting ? 'Suggesting…' : 'Suggest categories'}
            </Button>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          illustration="file"
          title="Everything has a name"
          hint="New imports that no rule or heuristic recognizes will queue here for a quick human pass."
        />
      ) : (
        <>
          <form
            onSubmit={applyBulk}
            className="flex flex-wrap items-center gap-2 border-b border-edge px-5 py-2.5"
          >
            <p className="num mr-1 text-[12px] text-ink-2">
              {selected.size} of {rows.length} selected
            </p>
            <TextInput
              aria-label="Category for selected transactions"
              placeholder="category, e.g. dining"
              list="review-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 w-48 text-[13px]"
            />
            <datalist id="review-categories">
              {knownCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={selected.size === 0 || category.trim() === '' || categorize.isPending}
            >
              <IconCheck width={15} height={15} />
              Categorize {selected.size > 0 ? selected.size : ''}
            </Button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs text-ink-3">
                  <th className="w-10 px-5 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all uncategorized transactions"
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={toggleAll}
                      className="size-3.5 accent-(--accent)"
                    />
                  </th>
                  <th className="px-2 py-2 font-medium">Payee</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="num px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Suggestion</th>
                  <th className="px-4 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const sug = suggestions?.get(t.payee)
                  return (
                    <tr key={t.id} className="border-b border-edge last:border-0">
                      <td className="px-5 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${t.payee} on ${t.date}`}
                          checked={selected.has(t.id)}
                          onChange={() => toggle(t.id)}
                          className="size-3.5 accent-(--accent)"
                        />
                      </td>
                      <td className="px-2 py-2 font-medium text-ink">{t.payee}</td>
                      <td className="px-4 py-2 text-[12px] text-ink-3">{accountName(t.account_id)}</td>
                      <td className="px-4 py-2 text-[12px] text-ink-3">{formatDate(t.date)}</td>
                      <td
                        className={`num px-4 py-2 text-right ${t.amount < 0 ? 'text-ink' : 'text-positive'}`}
                      >
                        {formatMoney(t.amount, { cents: true })}
                      </td>
                      <td className="px-4 py-2">
                        {sug ? (
                          <button
                            type="button"
                            onClick={() => categorize.mutate([[t.id], sug.category])}
                            title={`Apply "${sug.category}" (${Math.round(sug.confidence * 100)}% confident)`}
                            className="num rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent transition-colors duration-150 hover:bg-accent hover:text-accent-fg"
                          >
                            {sug.category} · {Math.round(sug.confidence * 100)}%
                          </button>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRuleFor(t)}
                          aria-label={`Create rule from ${t.payee}`}
                        >
                          + Rule
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {ruleFor ? (
        <RuleModal
          payee={ruleFor.payee}
          initialCategory={suggestions?.get(ruleFor.payee)?.category ?? ''}
          categories={knownCategories}
          onClose={() => setRuleFor(null)}
        />
      ) : null}
    </Card>
  )
}

/* ------------------------------ rule modal -------------------------------- */

function RuleModal({
  payee,
  initialCategory,
  categories,
  onClose,
}: {
  payee: string
  initialCategory: string
  categories: string[]
  onClose: () => void
}) {
  const createRule = useCreateRule()
  const applyRules = useApplyRules()
  const { data: rules } = useRules()

  const [pattern, setPattern] = useState(() => payeeRulePattern(payee))
  const [match, setMatch] = useState<'contains' | 'exact'>('contains')
  const [category, setCategory] = useState(initialCategory)
  const [applyNow, setApplyNow] = useState(true)

  const valid = pattern.trim().length > 0 && category.trim().length > 0
  const busy = createRule.isPending || applyRules.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    createRule.mutate(
      [
        {
          pattern: pattern.trim().toLowerCase(),
          match,
          field: 'payee',
          category: category.trim().toLowerCase(),
          priority: Math.max(0, ...(rules ?? []).map((r) => r.priority)) + 1,
        },
      ],
      {
        onSuccess: () => {
          if (applyNow) applyRules.mutate([], { onSuccess: onClose })
          else onClose()
        },
      },
    )
  }

  return (
    <Modal title="Create category rule" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="-mt-1 text-[12px] text-ink-3">
          From <span className="font-medium text-ink-2">{payee}</span> — future imports matching this
          pattern are categorized automatically.
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Payee pattern">
            {(id) => (
              <TextInput id={id} autoFocus value={pattern} onChange={(e) => setPattern(e.target.value)} />
            )}
          </Field>
          <Field label="Match">
            {(id) => (
              <Select id={id} value={match} onChange={(e) => setMatch(e.target.value as 'contains' | 'exact')}>
                <option value="contains">Contains</option>
                <option value="exact">Exact</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Category">
          {(id) => (
            <>
              <TextInput
                id={id}
                list="rule-categories"
                placeholder="dining"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="rule-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={applyNow}
            onChange={(e) => setApplyNow(e.target.checked)}
            className="size-3.5 accent-(--accent)"
          />
          Apply to existing transactions now (never overwrites manual picks)
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Create rule'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------- rules card ------------------------------- */

function RulesCard() {
  const { data: rules, isPending } = useRules()
  const applyRules = useApplyRules()
  const deleteRule = useDeleteRule()
  const [lastRun, setLastRun] = useState<number | null>(null)

  if (isPending) return <Skeleton className="h-32" />

  return (
    <Card>
      <CardHeader
        title="Category rules"
        hint="Applied on import in priority order — first match wins, manual picks always survive"
        action={
          (rules ?? []).length > 0 ? (
            <span className="flex items-center gap-2">
              {lastRun !== null ? (
                <span className="num text-[11px] text-ink-3">{lastRun} recategorized</span>
              ) : null}
              <Button
                variant="subtle"
                size="sm"
                disabled={applyRules.isPending}
                onClick={() =>
                  applyRules.mutate([], { onSuccess: (r) => setLastRun(r.recategorized) })
                }
              >
                {applyRules.isPending ? 'Running…' : 'Run rules now'}
              </Button>
            </span>
          ) : undefined
        }
      />
      {(rules ?? []).length === 0 ? (
        <p className="px-5 pt-1 pb-5 text-[13px] text-ink-3">
          No rules yet — use “+ Rule” on any uncategorized transaction to teach the importer.
        </p>
      ) : (
        <ul className="divide-y divide-(--border) px-5 pt-1 pb-3">
          {(rules ?? []).map((r) => (
            <li key={r.id} className="group flex items-center gap-3 py-2">
              <span className="num w-8 shrink-0 text-[11px] text-ink-3">#{r.priority}</span>
              <p className="min-w-0 flex-1 truncate text-[13px] text-ink">
                payee {r.match === 'exact' ? 'is' : 'contains'}{' '}
                <span className="font-medium">“{r.pattern}”</span>
                <span className="text-ink-3"> → </span>
                <span className="font-medium capitalize">{r.category}</span>
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={() => deleteRule.mutate([r.id])}
                aria-label={`Delete rule ${r.pattern}`}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

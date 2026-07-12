/** Balance snapshot history: mini area chart, add-snapshot form, and the
 * snapshot list. Shared by the accounts-table drawer and (promoted, #30)
 * the account detail page. */

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useAddBalance, useBalances, useDeleteBalance } from '@/api/queries'
import type { Account } from '@/api/types'
import { LIABILITY_TYPES } from '@/api/types'
import { AreaChart } from '@/charts/AreaChart'
import { Button } from '@/components/Button'
import { Field, TextInput } from '@/components/Field'
import { Skeleton } from '@/components/Skeleton'
import { IconTrash } from '@/components/icons'
import { formatDate, formatMoney, todayISO } from '@/lib/format'

export function BalanceHistoryPanel({ account }: { account: Account }) {
  const { data: snaps, isPending } = useBalances(account.id)
  const addBalance = useAddBalance()
  const delBalance = useDeleteBalance()
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const negative = LIABILITY_TYPES.includes(account.type)

  function submit(e: FormEvent) {
    e.preventDefault()
    const num = Number(amount.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(num) || !date) return
    addBalance.mutate([account.id, { date, amount: num }], { onSuccess: () => setAmount('') })
  }

  const sorted = useMemo(() => [...(snaps ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)), [snaps])

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {sorted.length >= 2 ? (
        <AreaChart
          points={[...sorted].reverse().map((s) => ({ date: s.date, value: negative ? -s.amount : s.amount }))}
          height={150}
          ariaLabel={`${account.name} balance history`}
        />
      ) : null}

      <form onSubmit={submit} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label="Date">
          {(id) => <TextInput id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Amount">
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              className="num"
              placeholder={String(account.balance)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Button variant="primary" type="submit" disabled={addBalance.isPending || amount === ''}>
          Add
        </Button>
      </form>

      <ul className="divide-y divide-(--border) rounded-(--radius-s) border border-edge">
        {sorted.map((s) => (
          <li key={s.date} className="group flex items-center justify-between px-3 py-2">
            <span className="text-[13px] text-ink-2">{formatDate(s.date)}</span>
            <span className="flex items-center gap-1">
              <span className="num text-[13px] font-medium text-ink">{formatMoney(s.amount)}</span>
              <button
                type="button"
                onClick={() => delBalance.mutate([account.id, s.date])}
                aria-label={`Delete snapshot ${s.date}`}
                className="rounded p-1 text-ink-3 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-negative"
              >
                <IconTrash width={14} height={14} />
              </button>
            </span>
          </li>
        ))}
        {sorted.length === 0 ? (
          <li className="px-3 py-6 text-center text-[13px] text-ink-3">No snapshots yet.</li>
        ) : null}
      </ul>
    </div>
  )
}

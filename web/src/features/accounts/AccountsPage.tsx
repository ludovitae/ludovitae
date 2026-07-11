import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  useAccounts,
  useAddBalance,
  useBalances,
  useCreateAccount,
  useDeleteAccount,
  useDeleteBalance,
  usePatchAccount,
} from '@/api/queries'
import type { Account, AccountCreate, AccountType, AssetClass } from '@/api/types'
import { ACCOUNT_TYPES, INVESTABLE_TYPES, LIABILITY_TYPES } from '@/api/types'
import { AreaChart } from '@/charts/AreaChart'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Field, Select, TextInput } from '@/components/Field'
import { Drawer, Modal } from '@/components/Overlay'
import { Skeleton } from '@/components/Skeleton'
import { IconHistory, IconPlus, IconTrash, TYPE_ICONS } from '@/components/icons'
import { formatDate, formatMoney, todayISO } from '@/lib/format'
import { PageHeader } from '@/layout/AppShell'

const TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  hsa: 'HSA',
  property: 'Property',
  vehicle: 'Vehicle',
  other_asset: 'Other asset',
  mortgage: 'Mortgage',
  loan: 'Loan',
  credit_card: 'Credit card',
  other_liability: 'Other liability',
}

export function AccountsPage() {
  const { data: accounts, isPending } = useAccounts()
  const [adding, setAdding] = useState(false)
  const [historyFor, setHistoryFor] = useState<Account | null>(null)

  const groups = useMemo(() => {
    const assets = (accounts ?? []).filter((a) => !LIABILITY_TYPES.includes(a.type))
    const liabilities = (accounts ?? []).filter((a) => LIABILITY_TYPES.includes(a.type))
    return { assets, liabilities }
  }, [accounts])

  return (
    <>
      <PageHeader
        title="Accounts"
        hint="Balances are snapshots — edit inline to record today’s number"
        action={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <IconPlus width={16} height={16} /> Add account
          </Button>
        }
      />

      {isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-32" />
        </div>
      ) : (accounts ?? []).length === 0 ? (
        <Card>
          <EmptyState
            illustration="coins"
            title="No accounts yet"
            hint="Everything you own and owe, in one list. Start with the big ones — investments, the house, the mortgage."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <IconPlus width={16} height={16} /> Add account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <AccountGroup title="Assets" accounts={groups.assets} onHistory={setHistoryFor} />
          <AccountGroup title="Liabilities" accounts={groups.liabilities} onHistory={setHistoryFor} negative />
        </div>
      )}

      {adding ? <AddAccountModal onClose={() => setAdding(false)} /> : null}
      {historyFor ? <HistoryDrawer account={historyFor} onClose={() => setHistoryFor(null)} /> : null}
    </>
  )
}

function AccountGroup({
  title,
  accounts,
  onHistory,
  negative,
}: {
  title: string
  accounts: Account[]
  onHistory: (a: Account) => void
  negative?: boolean
}) {
  if (accounts.length === 0) return null
  const total = accounts.reduce((s, a) => s + (a.include_in_net_worth ? a.balance : 0), 0)
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h2>
        <p className="num text-[13px] font-medium text-ink-2">{formatMoney(negative ? -total : total)}</p>
      </div>
      <Card>
        <ul className="divide-y divide-(--border)">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} negative={negative} onHistory={() => onHistory(a)} />
          ))}
        </ul>
      </Card>
    </section>
  )
}

function AccountRow({
  account,
  negative,
  onHistory,
}: {
  account: Account
  negative?: boolean
  onHistory: () => void
}) {
  const Icon = TYPE_ICONS[account.type] ?? TYPE_ICONS.other_asset!
  const del = useDeleteAccount()
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="group flex items-center gap-4 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-s) bg-surface-2 text-ink-2">
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{account.name}</p>
        <p className="truncate text-xs text-ink-3">
          {TYPE_LABELS[account.type]}
          {account.institution && account.institution !== '—' ? ` · ${account.institution}` : ''}
          {account.asset_class ? ` · ${account.asset_class}` : ''}
          {account.growth_rate_pct !== null ? ` · ${account.growth_rate_pct > 0 ? '+' : ''}${account.growth_rate_pct}%/yr` : ''}
        </p>
      </div>
      <InlineBalance account={account} negative={negative} />
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="sm" onClick={onHistory} aria-label={`Balance history for ${account.name}`}>
          <IconHistory width={16} height={16} />
        </Button>
        {confirming ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => del.mutate([account.id])}
            onBlur={() => setConfirming(false)}
            aria-label={`Confirm delete ${account.name}`}
          >
            Sure?
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete ${account.name}`}>
            <IconTrash width={16} height={16} />
          </Button>
        )}
      </div>
    </li>
  )
}

/** Click-to-edit balance. Enter saves (creates a snapshot dated today). */
function InlineBalance({ account, negative }: { account: Account; negative?: boolean }) {
  const patch = usePatchAccount()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  function start() {
    setValue(String(account.balance))
    setEditing(true)
  }
  function commit() {
    const num = Number(value.replace(/[$,\s]/g, ''))
    setEditing(false)
    if (Number.isFinite(num) && num !== account.balance) {
      patch.mutate([account.id, { balance: num }])
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        aria-label={`Balance for ${account.name}`}
        className="num h-8 w-32 rounded-(--radius-s) border border-(--accent) bg-surface-3 px-2 text-right text-sm text-ink"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={start}
      className={`num rounded-(--radius-s) px-2 py-1 text-right text-sm font-semibold transition-colors duration-150 hover:bg-surface-2 ${
        patch.isPending ? 'opacity-50' : ''
      } ${negative ? 'text-negative' : 'text-ink'}`}
      title="Click to update balance"
    >
      {formatMoney(negative ? -account.balance : account.balance)}
    </button>
  )
}

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const create = useCreateAccount()
  const [form, setForm] = useState<AccountCreate>({
    name: '',
    type: 'checking',
    institution: '',
    balance: 0,
    growth_rate_pct: null,
    asset_class: 'cash',
    member_id: null,
    include_in_net_worth: true,
    notes: '',
  })
  const investable = INVESTABLE_TYPES.includes(form.type)
  const physical = form.type === 'property' || form.type === 'vehicle' || form.type === 'other_asset'

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    create.mutate(
      [
        {
          ...form,
          asset_class: investable ? form.asset_class : null,
          growth_rate_pct: physical ? form.growth_rate_pct : null,
        },
      ],
      { onSuccess: onClose },
    )
  }

  return (
    <Modal title="Add account" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name">
          {(id) => (
            <TextInput
              id={id}
              autoFocus
              value={form.name}
              placeholder="Vanguard Brokerage"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select
                id={id}
                value={form.type}
                onChange={(e) => {
                  const type = e.target.value as AccountType
                  setForm({
                    ...form,
                    type,
                    asset_class: INVESTABLE_TYPES.includes(type)
                      ? type === 'savings'
                        ? 'cash'
                        : 'stocks'
                      : null,
                  })
                }}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Institution">
            {(id) => (
              <TextInput
                id={id}
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={LIABILITY_TYPES.includes(form.type) ? 'Amount owed' : 'Current balance'}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                className="num"
                value={String(form.balance)}
                onChange={(e) => setForm({ ...form, balance: Number(e.target.value.replace(/[$,\s]/g, '')) || 0 })}
              />
            )}
          </Field>
          {investable ? (
            <Field label="Asset class" hint="Drives simulated returns">
              {(id) => (
                <Select
                  id={id}
                  value={form.asset_class ?? 'mixed'}
                  onChange={(e) => setForm({ ...form, asset_class: e.target.value as AssetClass })}
                >
                  <option value="stocks">Stocks</option>
                  <option value="bonds">Bonds</option>
                  <option value="cash">Cash</option>
                  <option value="mixed">Mixed</option>
                </Select>
              )}
            </Field>
          ) : physical ? (
            <Field label="Growth %/yr" hint="Negative for depreciation">
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  className="num"
                  value={form.growth_rate_pct === null ? '' : String(form.growth_rate_pct)}
                  placeholder="3.0"
                  onChange={(e) =>
                    setForm({ ...form, growth_rate_pct: e.target.value === '' ? null : Number(e.target.value) || 0 })
                  }
                />
              )}
            </Field>
          ) : null}
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!form.name.trim() || create.isPending}>
            {create.isPending ? 'Adding…' : 'Add account'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function HistoryDrawer({ account, onClose }: { account: Account; onClose: () => void }) {
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

  return (
    <Drawer title={account.name} hint="Balance history — each snapshot is a point on your net-worth chart" onClose={onClose}>
      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      ) : (
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
      )}
    </Drawer>
  )
}

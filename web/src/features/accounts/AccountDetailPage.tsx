/** #30 per-account settings page (/accounts/:id): edit the details imports
 * guessed, see the external-link status, the promoted balance-snapshot
 * history, this account's recent transactions — and jump into a pre-scoped
 * import. Type changes surface their consequences inline BEFORE save
 * (decision-support: an informative note, never a blocking modal). */

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAccounts, useHousehold, usePatchAccount, useTransactions } from '@/api/queries'
import type { Account, AccountPatch, AccountType, AssetClass } from '@/api/types'
import { ACCOUNT_TYPES, INVESTABLE_TYPES, LIABILITY_TYPES } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, CardHeader } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Field, Select, TextInput, Toggle } from '@/components/Field'
import { Skeleton } from '@/components/Skeleton'
import { IconImport, TYPE_ICONS } from '@/components/icons'
import { typeChangeConsequences } from '@/lib/accountTypeChange'
import { formatDate, formatMoney } from '@/lib/format'
import { PageHeader } from '@/layout/AppShell'
import { BalanceHistoryPanel } from './BalanceHistoryPanel'
import { externalLinkLabel, TYPE_LABELS } from './accountLabels'

export function AccountDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const accountId = Number(id)
  const { data: accounts, isPending } = useAccounts()
  const account = (accounts ?? []).find((a) => a.id === accountId)

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-72" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (!account) {
    return (
      <Card>
        <EmptyState
          illustration="coins"
          title="Account not found"
          hint="It may have been deleted — the accounts list has everything that exists."
          action={
            <Button variant="primary" onClick={() => navigate('/accounts')}>
              Back to accounts
            </Button>
          }
        />
      </Card>
    )
  }
  return <AccountDetail key={account.id} account={account} />
}

/** Import-target types mirror the wizard's filter: everything except
 * non-card liabilities (you don't import a mortgage statement CSV). */
function importable(type: AccountType): boolean {
  return !LIABILITY_TYPES.includes(type) || type === 'credit_card'
}

function AccountDetail({ account }: { account: Account }) {
  const navigate = useNavigate()
  const Icon = TYPE_ICONS[account.type] ?? TYPE_ICONS.other_asset!
  const linkLabel = externalLinkLabel(account.external_account_masked)

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-ink-3">
        <Link to="/accounts" className="rounded-xs hover:text-ink-2 hover:underline">
          Accounts
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-2">{account.name}</span>
      </nav>
      <PageHeader
        title={account.name}
        hint={`${TYPE_LABELS[account.type]}${account.institution && account.institution !== '—' ? ` · ${account.institution}` : ''}${
          linkLabel ? ` · ${linkLabel}` : ''
        }`}
        action={
          importable(account.type) ? (
            <Button variant="primary" onClick={() => navigate(`/import?account=${account.id}`)}>
              <IconImport width={16} height={16} /> Import into this account
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <SettingsCard account={account} />
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Balance history"
              hint="Each snapshot is a point on your net-worth chart"
              action={
                <span className="grid size-8 place-items-center rounded-(--radius-s) bg-surface-2 text-ink-2">
                  <Icon />
                </span>
              }
            />
            <div className="px-5 pb-5">
              <BalanceHistoryPanel account={account} />
            </div>
          </Card>
          <RecentTransactions account={account} />
        </div>
      </div>
    </>
  )
}

/* ------------------------------ settings --------------------------------- */

interface Draft {
  name: string
  type: AccountType
  institution: string
  member_id: number | null
  asset_class: AssetClass | null
  growth_rate_pct: number | null
  include_in_net_worth: boolean
  notes: string
  track_freshness: boolean
  staleness_days: number | null
}

function toDraft(a: Account): Draft {
  return {
    name: a.name,
    type: a.type,
    institution: a.institution === '—' ? '' : (a.institution ?? ''),
    member_id: a.member_id,
    asset_class: a.asset_class,
    growth_rate_pct: a.growth_rate_pct,
    include_in_net_worth: a.include_in_net_worth,
    notes: a.notes,
    track_freshness: a.track_freshness,
    staleness_days: a.staleness_days,
  }
}

function SettingsCard({ account }: { account: Account }) {
  const patch = usePatchAccount()
  const { data: members } = useHousehold()
  const [draft, setDraft] = useState<Draft>(() => toDraft(account))
  const [savedFlash, setSavedFlash] = useState(false)

  const investable = INVESTABLE_TYPES.includes(draft.type)
  const physical = draft.type === 'property' || draft.type === 'vehicle' || draft.type === 'other_asset'
  const consequences = typeChangeConsequences(account.type, draft.type)

  const clean = useMemo(() => toDraft(account), [account])
  const dirty = JSON.stringify(draft) !== JSON.stringify(clean)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setSavedFlash(false)
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function setType(type: AccountType) {
    setSavedFlash(false)
    setDraft((d) => ({
      ...d,
      type,
      // keep a coherent asset class when entering the investable family;
      // clear class/growth for types they don't apply to (mirrors Add modal)
      asset_class: INVESTABLE_TYPES.includes(type)
        ? (d.asset_class ?? (type === 'savings' ? 'cash' : 'stocks'))
        : null,
      growth_rate_pct:
        type === 'property' || type === 'vehicle' || type === 'other_asset' ? d.growth_rate_pct : null,
    }))
  }

  function save(e: FormEvent) {
    e.preventDefault()
    if (!draft.name.trim() || !dirty) return
    // normalized form of the draft — this exact shape is what gets saved,
    // so adopting it locally lets `dirty` read clean after the round-trip
    const next: Draft = {
      ...draft,
      name: draft.name.trim(),
      institution: draft.institution.trim(),
      asset_class: investable ? draft.asset_class : null,
      growth_rate_pct: physical ? draft.growth_rate_pct : null,
    }
    patch.mutate([account.id, next satisfies AccountPatch], {
      onSuccess: () => {
        setDraft(next)
        setSavedFlash(true)
      },
    })
  }

  return (
    <Card>
      <CardHeader
        title="Account settings"
        hint="Imports guess these — correct anything that looks off"
      />
      <form onSubmit={save} className="flex flex-col gap-4 px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            {(id) => (
              <TextInput id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </Field>
          <Field label="Institution">
            {(id) => (
              <TextInput
                id={id}
                value={draft.institution}
                onChange={(e) => set('institution', e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={draft.type} onChange={(e) => setType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {investable ? (
            <Field label="Asset class" hint="Drives simulated returns">
              {(id) => (
                <Select
                  id={id}
                  value={draft.asset_class ?? 'mixed'}
                  onChange={(e) => set('asset_class', e.target.value as AssetClass)}
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
                  value={draft.growth_rate_pct === null ? '' : String(draft.growth_rate_pct)}
                  placeholder="3.0"
                  onChange={(e) =>
                    set('growth_rate_pct', e.target.value === '' ? null : Number(e.target.value) || 0)
                  }
                />
              )}
            </Field>
          ) : (
            <span />
          )}
        </div>

        {consequences.length > 0 ? (
          <div
            role="note"
            aria-label="What changes with this type"
            className="rounded-(--radius-s) border border-edge bg-surface-2 px-3 py-2.5"
          >
            <p className="text-[12px] font-semibold text-ink">
              Changing {TYPE_LABELS[account.type]} → {TYPE_LABELS[draft.type]} changes behavior:
            </p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-ink-2">
              {consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Field
          label="Owner"
          hint={draft.type === 'retirement' ? 'Sets whose RMD clock this account follows' : undefined}
        >
          {(id) => (
            <Select
              id={id}
              value={draft.member_id == null ? '' : String(draft.member_id)}
              onChange={(e) => set('member_id', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Household / shared</option>
              {(members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="w-full rounded-(--radius-s) border border-edge bg-surface-3 px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-edge-strong focus:border-transparent"
            />
          )}
        </Field>

        <div className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-surface-2 px-3 py-2.5">
          <div>
            <p className="text-[13px] font-medium text-ink">Count in net worth</p>
            <p className="text-[11px] text-ink-3">Off keeps the account visible without moving the headline number</p>
          </div>
          <Toggle
            checked={draft.include_in_net_worth}
            onChange={(v) => set('include_in_net_worth', v)}
            label="Count in net worth"
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-surface-2 px-3 py-2.5">
          <div>
            <p className="text-[13px] font-medium text-ink">Track import freshness</p>
            <p className="text-[11px] text-ink-3">Badge the account when its data goes stale</p>
          </div>
          <div className="flex items-center gap-3">
            {draft.track_freshness ? (
              <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
                warn after
                <TextInput
                  inputMode="numeric"
                  aria-label="Staleness threshold in days"
                  placeholder="35"
                  className="num h-7 w-14 px-2 text-[12px]"
                  value={draft.staleness_days === null ? '' : String(draft.staleness_days)}
                  onChange={(e) =>
                    set(
                      'staleness_days',
                      e.target.value.trim() === '' ? null : Math.max(1, Math.round(Number(e.target.value) || 0)),
                    )
                  }
                />
                days
              </label>
            ) : null}
            <Toggle
              checked={draft.track_freshness}
              onChange={(v) => set('track_freshness', v)}
              label="Track import freshness"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-edge pt-3">
          {savedFlash && !dirty ? <p className="text-[12px] text-positive">Saved</p> : null}
          <Button variant="primary" type="submit" disabled={!dirty || !draft.name.trim() || patch.isPending}>
            {patch.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ---------------------------- transactions ------------------------------- */

function RecentTransactions({ account }: { account: Account }) {
  const { data: txns, isPending } = useTransactions(account.id, 15)

  return (
    <Card>
      <CardHeader title="Recent transactions" hint="The newest imports into this account" />
      {isPending ? (
        <div className="px-5 pb-5">
          <Skeleton className="h-32" />
        </div>
      ) : (txns ?? []).length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-ink-3">
          Nothing here yet — import a bank export and its activity shows up in this list.
        </p>
      ) : (
        <ul className="divide-y divide-(--border) border-t border-edge">
          {(txns ?? []).slice(0, 15).map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2">
              <span className="num w-20 shrink-0 text-[12px] text-ink-3">{formatDate(t.date)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.payee || '—'}</span>
              {t.category ? (
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-3">
                  {t.category}
                </span>
              ) : null}
              <span
                className={`num shrink-0 text-[13px] font-medium ${t.amount < 0 ? 'text-ink' : 'text-positive'}`}
              >
                {formatMoney(t.amount, { cents: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

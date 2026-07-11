/** Household page (v1.1) — the people the plan takes care of. Member cards
 * with computed age + timing summary, add/edit/delete with the exactly-one-
 * self rule reflected in the UI (self role locked, self undeletable). */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useCreateMember, useDeleteMember, useHousehold, usePatchMember } from '@/api/queries'
import type { HouseholdMember, HouseholdMemberCreate, MemberRole } from '@/api/types'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Field, Select, TextInput } from '@/components/Field'
import { Modal } from '@/components/Overlay'
import { Skeleton } from '@/components/Skeleton'
import { Slider } from '@/components/Slider'
import { IconHousehold, IconPencil, IconPlus, IconTrash } from '@/components/icons'
import { formatMoney } from '@/lib/format'
import { SS_CLAIM_MAX, SS_CLAIM_MIN, ssClaimFactor } from '@/lib/ssFactor'
import { PageHeader } from '@/layout/AppShell'

const ROLE_LABELS: Record<MemberRole, string> = {
  self: 'You',
  partner: 'Partner',
  child: 'Child',
  other: 'Other',
}

export function HouseholdPage() {
  const { data: members, isPending } = useHousehold()
  const [editing, setEditing] = useState<HouseholdMember | 'new' | null>(null)

  return (
    <>
      <PageHeader
        title="Household"
        hint="The people the plan takes care of — ages, retirements, Social Security"
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <IconPlus width={16} height={16} /> Add member
          </Button>
        }
      />

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : (members ?? []).length === 0 ? (
        <Card>
          <EmptyState
            illustration="flag"
            title="Who's in the plan?"
            hint="Start with yourself — birthday, retirement age, Social Security — then add a partner or kids. The simulation follows everyone's timing."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                <IconPlus width={16} height={16} /> Add yourself
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(members ?? []).map((m) => (
              <MemberCard key={m.id} member={m} onEdit={() => setEditing(m)} />
            ))}
          </div>
          {(members ?? []).length === 1 ? (
            <p className="mt-4 flex items-center gap-2 px-1 text-[13px] text-ink-3">
              <IconHousehold width={16} height={16} />
              Just you so far — add a partner or kids and their timing shows up on the charts.
            </p>
          ) : null}
        </>
      )}

      {editing ? (
        <MemberModal
          member={editing === 'new' ? null : editing}
          members={members ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

function MemberCard({ member, onEdit }: { member: HouseholdMember; onEdit: () => void }) {
  const del = useDeleteMember()
  const [confirming, setConfirming] = useState(false)
  const year = new Date().getFullYear()
  const age = year - member.birth_year
  const isSelf = member.role === 'self'

  return (
    <Card>
      <div className="flex items-start gap-3 px-5 pt-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
          {member.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{member.name}</p>
          <p className="text-xs text-ink-3">
            {ROLE_LABELS[member.role]} · <span className="num">{age}</span> years old
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${member.name}`}>
            <IconPencil width={15} height={15} />
          </Button>
          {isSelf ? null : confirming ? (
            <Button
              variant="danger"
              size="sm"
              disabled={del.isPending}
              onClick={() => del.mutate([member.id])}
              onBlur={() => setConfirming(false)}
              aria-label={`Confirm delete ${member.name}`}
            >
              Sure?
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${member.name}`}
            >
              <IconTrash width={15} height={15} />
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-5 pt-3 pb-4 text-[13px]">
        <SummaryRow
          label="Retires"
          value={
            member.retirement_age != null ? (
              <>
                at <span className="num font-medium">{member.retirement_age}</span>
                <span className="text-ink-3"> · {member.birth_year + member.retirement_age}</span>
              </>
            ) : (
              <span className="text-ink-3">—</span>
            )
          }
        />
        <SummaryRow
          label="Social Security"
          value={
            member.ss_monthly_at_fra != null ? (
              <>
                <span className="num font-medium">{formatMoney(member.ss_monthly_at_fra)}</span>
                /mo at FRA
                {member.ss_claim_age != null ? (
                  <span className="text-ink-3">
                    {' '}
                    · claims {member.ss_claim_age} ({Math.round(ssClaimFactor(member.ss_claim_age) * 100)}%)
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-3">—</span>
            )
          }
        />
        <SummaryRow
          label="Plan to age"
          value={
            <>
              <span className="num font-medium">{member.life_expectancy}</span>
              <span className="text-ink-3"> · {member.birth_year + member.life_expectancy}</span>
            </>
          }
        />
      </dl>
      {isSelf ? (
        <p className="border-t border-edge px-5 py-2 text-[11px] text-ink-3">
          The plan is anchored to you — this member can’t be deleted.
        </p>
      ) : null}
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  )
}

function MemberModal({
  member,
  members,
  onClose,
}: {
  member: HouseholdMember | null
  members: HouseholdMember[]
  onClose: () => void
}) {
  const create = useCreateMember()
  const patch = usePatchMember()
  const isSelf = member?.role === 'self'
  const selfExists = members.some((m) => m.role === 'self')
  const year = new Date().getFullYear()

  const [name, setName] = useState(member?.name ?? '')
  const [role, setRole] = useState<MemberRole>(member?.role ?? (selfExists ? 'partner' : 'self'))
  const [birthYear, setBirthYear] = useState(String(member?.birth_year ?? year - 40))
  const [lifeExpectancy, setLifeExpectancy] = useState(String(member?.life_expectancy ?? 92))
  const [retirementAge, setRetirementAge] = useState(
    member?.retirement_age != null ? String(member.retirement_age) : '',
  )
  const [ssMonthly, setSsMonthly] = useState(
    member?.ss_monthly_at_fra != null ? String(member.ss_monthly_at_fra) : '',
  )
  const [claimAge, setClaimAge] = useState(member?.ss_claim_age ?? 67)
  const [notes, setNotes] = useState(member?.notes ?? '')

  const by = Number(birthYear)
  const le = Number(lifeExpectancy)
  const hasSs = ssMonthly.trim() !== ''
  const valid =
    name.trim().length > 0 &&
    Number.isFinite(by) &&
    by > 1900 &&
    by <= year &&
    Number.isFinite(le) &&
    le > 0

  const pending = create.isPending || patch.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || pending) return
    const payload: HouseholdMemberCreate = {
      name: name.trim(),
      role,
      birth_year: by,
      life_expectancy: le,
      retirement_age: retirementAge.trim() === '' ? null : Number(retirementAge) || null,
      ss_monthly_at_fra: hasSs ? Number(ssMonthly.replace(/[$,\s]/g, '')) || null : null,
      ss_claim_age: hasSs ? claimAge : null,
      notes,
    }
    if (member) patch.mutate([member.id, payload], { onSuccess: onClose })
    else create.mutate([payload], { onSuccess: onClose })
  }

  return (
    <Modal title={member ? `Edit ${member.name}` : 'Add household member'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            {(id) => (
              <TextInput id={id} autoFocus value={name} placeholder="Dana" onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Role" hint={isSelf ? 'The plan needs exactly one “you”' : undefined}>
            {(id) => (
              <Select
                id={id}
                value={role}
                disabled={isSelf}
                onChange={(e) => setRole(e.target.value as MemberRole)}
              >
                {/* exactly-one-self: the self option only exists where legal */}
                {isSelf || !selfExists ? <option value="self">{ROLE_LABELS.self}</option> : null}
                {!isSelf ? (
                  <>
                    <option value="partner">{ROLE_LABELS.partner}</option>
                    <option value="child">{ROLE_LABELS.child}</option>
                    <option value="other">{ROLE_LABELS.other}</option>
                  </>
                ) : null}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Birth year">
            {(id) => (
              <TextInput id={id} inputMode="numeric" className="num" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
            )}
          </Field>
          <Field label="Plan to age">
            {(id) => (
              <TextInput id={id} inputMode="numeric" className="num" value={lifeExpectancy} onChange={(e) => setLifeExpectancy(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Retirement age" hint="Blank for kids / non-earners">
            {(id) => (
              <TextInput id={id} inputMode="numeric" className="num" value={retirementAge} placeholder="—" onChange={(e) => setRetirementAge(e.target.value)} />
            )}
          </Field>
          <Field label="Social Security at FRA / mo" hint="Blank if none expected">
            {(id) => (
              <TextInput id={id} inputMode="decimal" className="num" value={ssMonthly} placeholder="—" onChange={(e) => setSsMonthly(e.target.value)} />
            )}
          </Field>
        </div>
        {hasSs ? (
          <Slider
            label="Claim age"
            value={claimAge}
            min={SS_CLAIM_MIN}
            max={SS_CLAIM_MAX}
            format={(v) => `${v} → ${Math.round(ssClaimFactor(v) * 100)}%`}
            hint="Share of the full (age-67) benefit"
            onChange={setClaimAge}
          />
        ) : null}
        <Field label="Notes">
          {(id) => <TextInput id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || pending}>
            {pending ? 'Saving…' : member ? 'Save member' : 'Add member'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

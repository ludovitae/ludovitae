import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'

const inputCls =
  'h-9 w-full rounded-(--radius-s) border border-edge bg-surface-3 px-3 text-sm text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-edge-strong focus:border-transparent'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input className={`${inputCls} ${className}`} {...rest} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const { className = '', children, ...rest } = props
  return (
    <select className={`${inputCls} appearance-none pr-8 ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-50 ${
        checked ? 'border-transparent bg-accent' : 'border-edge-strong bg-surface-3'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-[18px] rounded-full bg-surface shadow-1 transition-transform duration-150 ease-(--ease-out) ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  )
}

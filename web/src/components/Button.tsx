import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover active:translate-y-px shadow-1 border border-transparent',
  ghost:
    'bg-transparent text-ink-2 hover:text-ink hover:bg-surface-2 active:translate-y-px border border-transparent',
  subtle:
    'bg-surface-2 text-ink hover:bg-surface-3 active:translate-y-px border border-edge',
  danger:
    'bg-transparent text-negative hover:bg-negative/10 active:translate-y-px border border-transparent',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
}

export function Button({
  variant = 'subtle',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`inline-flex select-none items-center justify-center rounded-(--radius-s) font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

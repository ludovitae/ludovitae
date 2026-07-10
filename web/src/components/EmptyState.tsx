import type { ReactNode } from 'react'

/** Designed empty state: subtle line illustration + hint + primary action. */
export function EmptyState({
  title,
  hint,
  action,
  illustration = 'chart',
}: {
  title: string
  hint: string
  action?: ReactNode
  illustration?: 'chart' | 'coins' | 'flag' | 'file'
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <Illustration kind={illustration} />
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-ink-3">{hint}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

function Illustration({ kind }: { kind: 'chart' | 'coins' | 'flag' | 'file' }) {
  const common = {
    width: 96,
    height: 64,
    viewBox: '0 0 96 64',
    fill: 'none',
    'aria-hidden': true,
  } as const
  const stroke = 'var(--ink-3)'
  const accent = 'var(--accent)'
  switch (kind) {
    case 'chart':
      return (
        <svg {...common}>
          <rect x="8" y="8" width="80" height="48" rx="8" stroke={stroke} strokeDasharray="3 4" />
          <path d="M20 44c8 0 10-16 18-16s8 8 14 8 10-14 24-14" stroke={accent} strokeWidth="2" strokeLinecap="round" />
          <circle cx="76" cy="22" r="3" fill={accent} />
        </svg>
      )
    case 'coins':
      return (
        <svg {...common}>
          <ellipse cx="38" cy="22" rx="16" ry="6" stroke={stroke} />
          <path d="M22 22v10c0 3.3 7.2 6 16 6s16-2.7 16-6V22" stroke={stroke} />
          <path d="M22 32v10c0 3.3 7.2 6 16 6s16-2.7 16-6V32" stroke={stroke} />
          <circle cx="68" cy="40" r="12" stroke={accent} strokeWidth="2" />
          <path d="M68 34v12M64 37.5h6.5a2.6 2.6 0 1 1 0 5H64" stroke={accent} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'flag':
      return (
        <svg {...common}>
          <path d="M30 10v44" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          <path d="M30 12h34l-7 9 7 9H30" stroke={accent} strokeWidth="2" strokeLinejoin="round" />
          <path d="M20 54h34" stroke={stroke} strokeLinecap="round" strokeDasharray="2 5" />
        </svg>
      )
    case 'file':
      return (
        <svg {...common}>
          <path d="M32 8h22l12 12v36H32V8Z" stroke={stroke} />
          <path d="M54 8v12h12" stroke={stroke} />
          <path d="M40 32h16M40 39h16M40 46h9" stroke={accent} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
  }
}

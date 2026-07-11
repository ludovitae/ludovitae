/** Minimal hand-drawn stroke icon set — 1.5px stroke, currentColor. */

import type { SVGProps } from 'react'

function I({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconDashboard = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <rect x="3" y="3" width="6" height="8" rx="1.5" />
    <rect x="3" y="14" width="6" height="3" rx="1.5" />
    <rect x="12" y="3" width="5" height="3" rx="1.5" />
    <rect x="12" y="9" width="5" height="8" rx="1.5" />
  </I>
)

export const IconAccounts = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <rect x="2.5" y="5" width="15" height="11" rx="2" />
    <path d="M2.5 8.5h15" />
    <path d="M5.5 12.5h4" />
  </I>
)

export const IconScenarios = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M3 16c3.5 0 4-9 7-9" />
    <path d="M3 16c4.5 0 5-4 7-4s2.5 4 7 4" opacity=".45" />
    <path d="M10 7c2 0 3 3 7 3" />
    <circle cx="17" cy="10" r="1.4" fill="currentColor" stroke="none" />
  </I>
)

export const IconGoals = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="10" cy="10" r="7" />
    <circle cx="10" cy="10" r="3.2" />
    <circle cx="10" cy="10" r="0.5" fill="currentColor" />
  </I>
)

export const IconImport = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M10 3v9" />
    <path d="m6.5 8.8 3.5 3.4 3.5-3.4" />
    <path d="M4 16.5h12" />
  </I>
)

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.8v2.4M10 14.8v2.4M2.8 10h2.4M14.8 10h2.4M4.9 4.9l1.7 1.7M13.4 13.4l1.7 1.7M15.1 4.9l-1.7 1.7M6.6 13.4l-1.7 1.7" />
  </I>
)

export const IconHousehold = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="7.2" cy="6.8" r="2.6" />
    <path d="M2.8 16.5c.4-3.1 2.2-4.9 4.4-4.9s4 1.8 4.4 4.9" />
    <circle cx="13.8" cy="7.6" r="2.1" opacity=".55" />
    <path d="M13 12.6c2 .1 3.7 1.6 4.2 3.9" opacity=".55" />
  </I>
)

export const IconSpending = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <rect x="2.5" y="5.5" width="15" height="10.5" rx="2" />
    <path d="M13.2 5.5V4.2A1.2 1.2 0 0 0 11.8 3L4 4.6" />
    <path d="M17.5 9.5h-3.2a1.6 1.6 0 0 0 0 3.2h3.2" />
  </I>
)

export const IconWarning = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M10 3.2 17.6 16H2.4L10 3.2Z" />
    <path d="M10 8.2v3.6M10 14.1v.1" />
  </I>
)

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </I>
)

export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </I>
)

export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
  </I>
)

export const IconHistory = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M3.5 10a6.5 6.5 0 1 1 1.9 4.6" />
    <path d="M3.5 10V6.5M3.5 10H7" />
    <path d="M10 6.8V10l2.4 1.6" />
  </I>
)

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M4 5.5h12M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M6 5.5l.7 10a1.5 1.5 0 0 0 1.5 1.4h3.6a1.5 1.5 0 0 0 1.5-1.4l.7-10" />
  </I>
)

export const IconPencil = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M12.8 3.7a1.7 1.7 0 0 1 2.4 2.4l-8.3 8.3-3.2.8.8-3.2 8.3-8.3Z" />
  </I>
)

export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M8 3h4l.6 5.2 2.4 2.3H5l2.4-2.3L8 3Z" />
    <path d="M10 10.5V17" />
  </I>
)

export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M8 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3" />
    <path d="M13 6.5 16.5 10 13 13.5M16.5 10H8" />
  </I>
)

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </I>
)

export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M10 13V4" />
    <path d="M6.5 7.2 10 3.8l3.5 3.4" />
    <path d="M4 16.5h12" />
  </I>
)

export const IconLock = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <rect x="4.5" y="9" width="11" height="8" rx="1.8" />
    <path d="M7 9V6.8a3 3 0 0 1 6 0V9" />
  </I>
)

export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M10 3c.7 3.6 2 5 5.7 5.7C12 9.4 10.7 10.7 10 14.3 9.3 10.7 8 9.4 4.3 8.7 8 8 9.3 6.6 10 3Z" />
    <path d="M15.5 13.2c.3 1.5.9 2.1 2.4 2.4-1.5.3-2.1.9-2.4 2.4-.3-1.5-.9-2.1-2.4-2.4 1.5-.3 2.1-.9 2.4-2.4Z" />
  </I>
)

/** Account-type glyphs for the accounts table. */
// eslint-disable-next-line react-refresh/only-export-components
export const TYPE_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => ReturnType<typeof I>> = {
  checking: (p) => (
    <I {...p}>
      <rect x="2.5" y="5" width="15" height="10" rx="2" />
      <path d="M2.5 8.5h15" />
    </I>
  ),
  savings: (p) => (
    <I {...p}>
      <path d="M4 9.5a6 5.3 0 0 1 12 .6c0 1.6-.7 2.9-1.8 3.8l.3 2.1h-2l-.4-1.2h-3.7l-.4 1.2h-2l.3-2.3A5.6 5.6 0 0 1 4 9.5Z" />
      <circle cx="13.2" cy="9" r="0.6" fill="currentColor" stroke="none" />
    </I>
  ),
  brokerage: (p) => (
    <I {...p}>
      <path d="M3.5 15.5 8 10l3 2.5 5.5-6.5" />
      <path d="M13 6h3.5v3.5" />
    </I>
  ),
  retirement: (p) => (
    <I {...p}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5A6.5 6.5 0 0 1 16.5 10H10V3.5Z" fill="currentColor" fillOpacity=".25" stroke="none" />
      <path d="M10 10V3.5M10 10h6.5" />
    </I>
  ),
  hsa: (p) => (
    <I {...p}>
      <path d="M10 17s-6.5-3.8-6.5-8.3A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 6.5 2.7C16.5 13.2 10 17 10 17Z" />
      <path d="M8 10h4M10 8v4" />
    </I>
  ),
  property: (p) => (
    <I {...p}>
      <path d="m3.5 9.5 6.5-6 6.5 6" />
      <path d="M5.5 8.5v7.5h9V8.5" />
      <path d="M8.5 16v-4h3v4" />
    </I>
  ),
  vehicle: (p) => (
    <I {...p}>
      <path d="M4 12.5 5.4 8a2 2 0 0 1 1.9-1.4h5.4A2 2 0 0 1 14.6 8l1.4 4.5" />
      <rect x="3" y="12" width="14" height="3.5" rx="1.2" />
      <circle cx="6.5" cy="15.5" r="1.2" />
      <circle cx="13.5" cy="15.5" r="1.2" />
    </I>
  ),
  other_asset: (p) => (
    <I {...p}>
      <rect x="3.5" y="6.5" width="13" height="10" rx="1.8" />
      <path d="M7 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 5v1.5" />
    </I>
  ),
  mortgage: (p) => (
    <I {...p}>
      <path d="m3.5 9.5 6.5-6 6.5 6" />
      <path d="M5.5 8.5v7.5h9V8.5" />
      <path d="M8 13.5h4" />
    </I>
  ),
  loan: (p) => (
    <I {...p}>
      <rect x="3" y="4.5" width="14" height="11" rx="2" />
      <path d="M6.5 8h7M6.5 11h4" />
    </I>
  ),
  credit_card: (p) => (
    <I {...p}>
      <rect x="2.5" y="5" width="15" height="10" rx="2" />
      <path d="M2.5 8h15M5.5 12h3" />
    </I>
  ),
  other_liability: (p) => (
    <I {...p}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5v4M10 13.4v.1" />
    </I>
  ),
}

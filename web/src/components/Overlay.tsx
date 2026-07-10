import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './icons'

/** Shared scrim + escape/scroll-lock handling for Modal and Drawer. */
function useOverlay(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the panel for keyboard users.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input, select, button, textarea, [tabindex]',
    )
    first?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return panelRef
}

export function Modal({
  title,
  onClose,
  children,
  width = '28rem',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** CSS max-width for the panel */
  width?: string
}) {
  const ref = useOverlay(onClose)
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full animate-[modal-in_180ms_var(--ease-out)] rounded-(--radius-l) border border-edge bg-surface shadow-2"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <IconX />
          </button>
        </div>
        <div className="px-5 pt-3 pb-5">{children}</div>
      </div>
      <style>{`@keyframes modal-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }`}</style>
    </div>,
    document.body,
  )
}

export function Drawer({
  title,
  hint,
  onClose,
  children,
}: {
  title: string
  hint?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useOverlay(onClose)
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full max-w-md animate-[drawer-in_220ms_var(--ease-out)] flex-col border-l border-edge bg-surface shadow-2"
      >
        <div className="flex items-start justify-between border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <IconX />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
      <style>{`@keyframes drawer-in { from { transform: translateX(24px); opacity: 0; } }`}</style>
    </div>,
    document.body,
  )
}

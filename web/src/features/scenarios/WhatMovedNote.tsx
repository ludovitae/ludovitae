/** T-011b — dismissable inline note surfacing `engine_notes` when the
 * engine version changed since this browser last simulated. Quiet by
 * design: neutral surface (a model update is news, not an error), lives
 * once next to the chart it explains, and is gone forever per version
 * pair once dismissed. */

import { useEffect, useState } from 'react'
import type { EngineChange } from '@/lib/engineVersion'
import { checkEngineVersion, dismissEngineChange } from '@/lib/engineVersion'
import { Button } from '@/components/Button'

export function WhatMovedNote({
  engineVersion,
  notes,
}: {
  engineVersion: string
  notes: string[]
}) {
  const [change, setChange] = useState<EngineChange | null>(null)
  useEffect(() => {
    setChange(checkEngineVersion(engineVersion))
  }, [engineVersion])

  if (!change) return null
  return (
    <div className="flex items-start justify-between gap-3 rounded-(--radius-m) border border-edge bg-surface px-4 py-3 text-[13px] shadow-1">
      <div className="min-w-0">
        <p className="font-medium text-ink">
          The engine behind these numbers changed{' '}
          <span className="num font-normal text-ink-3">
            (v{change.from} → v{change.to})
          </span>
        </p>
        {notes.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-ink-2">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-[11px] text-ink-3">
          Same plan, updated model — small moves in the numbers are expected.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          dismissEngineChange(change)
          setChange(null)
        }}
      >
        Got it
      </Button>
    </div>
  )
}

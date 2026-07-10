import { useId } from 'react'

/** Labeled range slider with live value readout. Keyboard accessible by
 * nature of <input type=range>; styled via tokens. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (v: number) => string
  onChange: (v: number) => void
  hint?: string
}) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-medium text-ink-2">
          {label}
        </label>
        <span className="num text-sm font-semibold text-ink">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="gol-slider"
        style={{ ['--fill' as string]: `${pct}%` }}
        aria-valuetext={format(value)}
      />
      {hint ? <p className="text-[11px] text-ink-3">{hint}</p> : null}
    </div>
  )
}

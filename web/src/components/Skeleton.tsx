export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-(--radius-s) bg-surface-2 ${className}`}
    />
  )
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-3.5 animate-pulse rounded bg-surface-2"
          style={{ width: `${100 - i * 14}%` }}
        />
      ))}
    </div>
  )
}

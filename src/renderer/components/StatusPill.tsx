import type { PersonRecord } from '@shared/types'
import { cn } from '../lib/utils'
import { statusOf, type StatusKind } from '../lib/person-display'

const STYLES: Record<StatusKind, string> = {
  active: 'bg-emerald-100 text-emerald-700 ring-emerald-700/20',
  inactive: 'bg-slate-200 text-slate-700 ring-slate-700/20',
  pending: 'bg-amber-100 text-amber-800 ring-amber-700/20',
  deceased: 'bg-rose-100 text-rose-800 ring-rose-700/20',
  unknown: 'bg-muted text-muted-foreground ring-muted-foreground/20'
}

export function StatusPill({
  person,
  className
}: {
  person: PersonRecord
  className?: string
}): JSX.Element {
  const s = statusOf(person)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        STYLES[s.kind],
        className
      )}
    >
      {s.label}
    </span>
  )
}

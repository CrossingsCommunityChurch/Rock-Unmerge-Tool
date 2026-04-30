import type { PersonRecord } from '@shared/types'
import { RECORD_STATUS } from '@shared/types'

export type StatusKind = 'active' | 'inactive' | 'pending' | 'deceased' | 'unknown'

export interface StatusInfo {
  kind: StatusKind
  label: string
}

/** Map a Person row to a display status. IsDeceased takes precedence over
 *  RecordStatusValueId because Rock's convention is "the person has died,
 *  surface that regardless of any record-status state." */
export function statusOf(p: PersonRecord): StatusInfo {
  if (truthy(p.IsDeceased)) return { kind: 'deceased', label: 'Deceased' }
  switch (p.RecordStatusValueId) {
    case RECORD_STATUS.ACTIVE:
      return { kind: 'active', label: 'Active' }
    case RECORD_STATUS.INACTIVE:
      return { kind: 'inactive', label: 'Inactive' }
    case RECORD_STATUS.PENDING:
      return { kind: 'pending', label: 'Pending' }
    default:
      return {
        kind: 'unknown',
        label: p.RecordStatusValueId == null ? '—' : `Status ${p.RecordStatusValueId}`
      }
  }
}

export function fullName(p: PersonRecord): string {
  const nick = p.NickName && p.NickName !== p.FirstName ? ` "${p.NickName}"` : ''
  return `${p.FirstName ?? ''}${nick} ${p.LastName ?? ''}`.trim() || '(no name)'
}

/** True when first+last on the two records don't agree — shown as a warning. */
export function namesDisagree(a: PersonRecord, b: PersonRecord): boolean {
  return (
    (a.FirstName ?? '').trim().toLowerCase() !== (b.FirstName ?? '').trim().toLowerCase() ||
    (a.LastName ?? '').trim().toLowerCase() !== (b.LastName ?? '').trim().toLowerCase()
  )
}

function truthy(v: PersonRecord['IsDeceased']): boolean {
  return v === 1 || v === true
}

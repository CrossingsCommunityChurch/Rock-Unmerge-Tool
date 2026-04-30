// Audit log — writes one plain-text log file per commit (success OR failure)
// to <userData>/audit-logs/, and appends a one-line summary entry to a
// manifest.json in the same directory for chronological scanning without
// having to open every log file.
//
// Filename pattern (per build-spec Q6):
//   unmerge-<ISO8601>-<lastname>-<firstname>-<previousPersonId>-to-<currentPersonId>.log
// All name components are sanitized to filesystem-safe characters.

import { app } from 'electron'
import os from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AnalyzeRequest,
  AnalyzeResult,
  AppMode,
  CommitResult,
  ConnectionConfig,
  PersonRecord
} from '@shared/types'

const MANIFEST_NAME = 'manifest.json'
const AUDIT_DIR_NAME = 'audit-logs'

export interface AuditContext {
  mode: AppMode
  request: AnalyzeRequest
  liveLabel: string
  backupLabel: string
  /** Pre-commit copies of the records (from the renderer's selection state).
   *  Used as a fallback if the engine result didn't run far enough to capture them. */
  previousPerson?: PersonRecord | null
  currentPerson?: PersonRecord | null
  wrongRecipientPerson?: PersonRecord | null
}

export interface WriteAuditArgs {
  context: AuditContext
  startedAt: string
  finishedAt: string
  /** Engine result. Present on success. May also be partially-populated on failure
   *  if the engine got far enough — but commonly absent in that case. */
  result?: AnalyzeResult
  committed: boolean
  /** When set, log status is FAILED. */
  error?: string
}

export function getAuditLogDir(): string {
  const dir = join(app.getPath('userData'), AUDIT_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function describeConnection(c: ConnectionConfig, mode: AppMode): string {
  if (mode === 'test') return `sqlite:test (${c.role})`
  return `${c.server || '(no host)'}/${c.database || '(no db)'} (mssql:${c.role})`
}

export function writeAuditLog(args: WriteAuditArgs): { path: string; filename: string } {
  const { context, startedAt, finishedAt, result, committed, error } = args
  const dir = getAuditLogDir()

  const previous = context.previousPerson ?? result?.backupPerson ?? null
  const current = context.currentPerson ?? result?.livePerson ?? null
  const wrong = context.wrongRecipientPerson ?? result?.wrongRecipientPerson ?? null

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const last = sanitizeForFilename(previous?.LastName ?? 'unknown')
  const first = sanitizeForFilename(previous?.FirstName ?? 'unknown')
  const filename =
    `unmerge-${ts}-${last}-${first}-${context.request.previousPersonId}-to-${context.request.currentPersonId}.log`
  const filePath = join(dir, filename)

  const status = error ? 'FAILED' : committed ? 'SUCCESS' : 'DRY_RUN'

  const lines: string[] = []
  lines.push('=== Rock Unmerge Audit Log ===')
  lines.push(`Timestamp:   ${new Date().toISOString()}`)
  lines.push(`OS User:     ${os.userInfo().username}`)
  lines.push(`Hostname:    ${os.hostname()}`)
  lines.push(`Platform:    ${process.platform} (${process.arch})`)
  lines.push(`App Mode:    ${context.mode}`)
  lines.push(`Status:      ${status}`)
  lines.push(`Started:     ${startedAt}`)
  lines.push(`Finished:    ${finishedAt}`)
  lines.push('')
  lines.push('== Connections ==')
  lines.push(`Live:    ${context.liveLabel}`)
  lines.push(`Backup:  ${context.backupLabel}  (read-only)`)
  lines.push('')
  lines.push('== Identify ==')
  lines.push(
    `Original  (backup): PersonId ${context.request.previousPersonId} -- ${formatName(previous)}`
  )
  lines.push(
    `New blank (live):   PersonId ${context.request.currentPersonId} -- ${formatName(current)}` +
      `  (PrimaryAliasId ${context.request.currentPersonAliasId})`
  )
  lines.push(
    `Wrong rec (live):   PersonId ${context.request.wrongRecipientPersonId} -- ${formatName(wrong)}`
  )
  lines.push('')

  if (result) {
    lines.push('== Verification ==')
    lines.push(
      `Aliases currently point at: [${result.verification.aliasCurrentRecipientIds.join(', ')}]`
    )
    lines.push(`Matches wrong recipient:    ${result.verification.matchesWrongRecipient}`)
    if (result.verification.message) lines.push(`Note: ${result.verification.message}`)
    lines.push('')

    lines.push('== Operation Summary ==')
    lines.push(`GroupMember updates:      ${result.totals.groupMemberUpdates}`)
    lines.push(`AttributeValue updates:   ${result.totals.attributeValueUpdates}`)
    lines.push(`UserLogin updates:        ${result.totals.userLoginUpdates}`)
    lines.push(`Alias reference updates:  ${result.totals.aliasReferenceUpdates}`)
    lines.push(`Profile column updates:   ${result.totals.profileColumnUpdates}`)
    lines.push(`Mobile phone updates:     ${result.totals.mobilePhoneUpdates}`)
    lines.push(`History (about-person):   ${result.totals.historyEntityUpdates}`)
    lines.push('')

    lines.push('== Profile Restore ==')
    if (result.profileRestore.personUpdates.length === 0) {
      lines.push('Person columns: (none -- backup had no values to copy)')
    } else {
      lines.push('Person columns:')
      for (const u of result.profileRestore.personUpdates) {
        const overwriteFlag = u.willOverwrite ? '  [OVERWROTE]' : ''
        lines.push(
          `  ${u.column}: backup=${formatLogValue(u.backupValue)} ` +
            `live(before)=${formatLogValue(u.liveValue)}${overwriteFlag}`
        )
      }
    }
    if (result.profileRestore.mobilePhoneIds.length === 0) {
      lines.push('Mobile phone ids: (none)')
    } else {
      lines.push(`Mobile phone ids: [${result.profileRestore.mobilePhoneIds.join(', ')}]`)
    }
    lines.push('')

    lines.push('== Tables Affected ==')
    if (result.affectedTables.length === 0) {
      lines.push('(none)')
    } else {
      for (const t of result.affectedTables) {
        lines.push(
          `[${t.tableName}].[${t.columnName}]: ${t.recordCount} live rows, ` +
            `${t.willUpdateCount} will update`
        )
      }
    }
    lines.push('')

    lines.push('== Read IDs (from backup) ==')
    lines.push(`Previous alias ids:  [${result.previousAliasIds.join(', ')}]`)
    lines.push(`GroupMember ids:     [${result.groupMemberIds.join(', ')}]`)
    lines.push(`AttributeValue ids:  [${result.attributeValueIds.join(', ')}]`)
    lines.push(`UserLogin ids:       [${result.userLoginIds.join(', ')}]`)
    lines.push(`History (about-person) ids: [${result.historyAboutPersonIds.join(', ')}]`)
    lines.push('')

    lines.push('== SQL Log ==')
    for (let i = 0; i < result.sqlLog.length; i++) {
      lines.push(`-- statement ${i + 1}`)
      lines.push(result.sqlLog[i])
      lines.push('')
    }
  }

  if (error) {
    lines.push('== Error ==')
    lines.push(error)
    lines.push('')
  }

  writeFileSync(filePath, lines.join('\n'), 'utf8')

  appendToManifest(dir, {
    timestamp: new Date().toISOString(),
    filename,
    status,
    mode: context.mode,
    previousPersonId: context.request.previousPersonId,
    currentPersonId: context.request.currentPersonId,
    wrongRecipientPersonId: context.request.wrongRecipientPersonId,
    previousPersonName: formatName(previous),
    live: context.liveLabel,
    backup: context.backupLabel,
    totals: result?.totals,
    errorMessage: error
  })

  return { path: filePath, filename }
}

interface ManifestEntry {
  timestamp: string
  filename: string
  status: 'SUCCESS' | 'FAILED' | 'DRY_RUN' | string
  mode: AppMode
  previousPersonId: number
  currentPersonId: number
  wrongRecipientPersonId: number
  previousPersonName: string | null
  live: string
  backup: string
  totals?: CommitResult['totals']
  errorMessage?: string
}

function appendToManifest(dir: string, entry: ManifestEntry): void {
  const path = join(dir, MANIFEST_NAME)
  let entries: ManifestEntry[] = []
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      entries = Array.isArray(parsed) ? (parsed as ManifestEntry[]) : []
    } catch {
      // Manifest unparseable. Sidestep: rename and start a new one rather than
      // silently overwriting whatever was there.
      try {
        const archived = `${path}.broken-${Date.now()}`
        writeFileSync(archived, readFileSync(path))
      } catch {
        // ignore — we'd rather lose the broken file than block the commit log
      }
      entries = []
    }
  }
  entries.push(entry)
  writeFileSync(path, JSON.stringify(entries, null, 2), 'utf8')
}

function sanitizeForFilename(s: string): string {
  const cleaned = s
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return cleaned || 'unknown'
}

function formatLogValue(v: string | number | null | undefined): string {
  if (v == null) return 'NULL'
  if (typeof v === 'string') return v === '' ? '""' : `"${v}"`
  return String(v)
}

function formatName(p: PersonRecord | null | undefined): string {
  if (!p) return '(unknown)'
  const name = [p.FirstName, p.LastName].filter(Boolean).join(' ').trim()
  return name || '(no name)'
}

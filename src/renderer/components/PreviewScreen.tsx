import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Play,
  ShieldCheck
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  AnalyzeRequest,
  AnalyzeResult,
  PersonRecord,
  UnmergeProgress
} from '@shared/types'
import { fullName, namesDisagree } from '../lib/person-display'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { StatusPill } from './StatusPill'

export interface PreviewScreenProps {
  request: AnalyzeRequest
  previousPerson: PersonRecord | null
  currentPerson: PersonRecord | null
  wrongRecipientPerson: PersonRecord | null
  onBack: () => void
  onProceed: (result: AnalyzeResult) => void
}

const STEP_LABELS: Record<UnmergeProgress['step'], string> = {
  'read-backup': 'Reading the original person from backup',
  'verify-recipients': 'Verifying alias recipients in live',
  'discover-schema': 'Discovering PersonAliasId columns',
  'count-impacts': 'Counting affected rows in live',
  'fetch-backup-row-ids': 'Fetching pre-merge row ids from backup',
  'write-group-member': 'Updating GroupMember',
  'write-attribute-value': 'Updating AttributeValue',
  'write-user-login': 'Updating UserLogin',
  'write-history-entity': 'Repointing History entries about the person',
  'write-alias-references': 'Repointing alias references',
  'write-profile-restore': 'Restoring profile basics from backup',
  'finalize-rollback': 'Rolling back (dry run)',
  'finalize-commit': 'Committing'
}

export function PreviewScreen(props: PreviewScreenProps): JSX.Element {
  const {
    request,
    previousPerson,
    currentPerson,
    wrongRecipientPerson,
    onBack,
    onProceed
  } = props

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<UnmergeProgress | null>(null)
  const [progressLog, setProgressLog] = useState<UnmergeProgress[]>([])
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const analyze = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress(null)
    setProgressLog([])
    const unsubscribe = window.api.unmerge.onProgress((event) => {
      setProgress(event)
      setProgressLog((prev) => [...prev, event])
    })
    try {
      const r = await window.api.unmerge.analyze(request)
      setResult(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      unsubscribe()
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Preview impact</h2>
        <p className="text-sm text-muted-foreground">
          Run the entire unmerge inside a transaction and roll back at the end. Nothing is
          persisted — this just shows you what a commit would do.
        </p>
      </header>

      {!result && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Button onClick={analyze} disabled={busy} size="lg" className="w-full sm:w-auto">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Analyze Impact
            </Button>
            {progress && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{STEP_LABELS[progress.step] ?? progress.step}</div>
                {progress.detail && (
                  <div className="text-xs text-muted-foreground mt-0.5">{progress.detail}</div>
                )}
                <ProgressTrail log={progressLog} />
              </div>
            )}
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <VerificationBanner result={result} request={request} />
          <SectionA
            previous={previousPerson}
            current={currentPerson}
            wrongRecipient={wrongRecipientPerson}
            result={result}
          />
          <SectionB result={result} />
          <SectionProfileRestore result={result} />
          <SectionC result={result} />
          <SectionD result={result} />
        </>
      )}

      <footer className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          {result && (
            <Button variant="secondary" onClick={analyze} disabled={busy} size="sm">
              Re-analyze
            </Button>
          )}
          <Button onClick={() => result && onProceed(result)} disabled={!result}>
            Proceed to Commit
          </Button>
        </div>
      </footer>
    </div>
  )
}

function ProgressTrail({ log }: { log: UnmergeProgress[] }): JSX.Element {
  if (log.length <= 1) return <div />
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground/80">
      {log.slice(0, -1).map((e, i) => (
        <li key={i}>✓ {STEP_LABELS[e.step] ?? e.step}</li>
      ))}
    </ul>
  )
}

function VerificationBanner({
  result,
  request
}: {
  result: AnalyzeResult
  request: AnalyzeRequest
}): JSX.Element {
  const v = result.verification
  if (v.matchesWrongRecipient) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 p-4 text-sm">
          <ShieldCheck className="h-4 w-4 mt-0.5 text-emerald-600" />
          <div>
            <div className="font-medium">Verification passed</div>
            <div className="text-muted-foreground">
              The original person's aliases currently point at the wrong-recipient you selected
              ({request.wrongRecipientPersonId}). Safe to proceed.
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className="border-amber-500/40 bg-amber-50/50">
      <CardContent className="flex items-start gap-2 p-4 text-sm text-amber-900">
        <AlertTriangle className="h-4 w-4 mt-0.5" />
        <div>
          <div className="font-medium">Verification mismatch</div>
          <div className="mt-0.5">
            {v.message ?? 'Unexpected state during verification — review carefully.'}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// --- Section A — Records to be unmerged ----------------------------------

function SectionA({
  previous,
  current,
  wrongRecipient,
  result
}: {
  previous: PersonRecord | null
  current: PersonRecord | null
  wrongRecipient: PersonRecord | null
  result: AnalyzeResult
}): JSX.Element {
  // Prefer freshly-fetched records from the engine result, falling back to the
  // copies passed from the Identify screen if any are null.
  const prev = result.backupPerson ?? previous
  const curr = result.livePerson ?? current
  const wrong = result.wrongRecipientPerson ?? wrongRecipient
  const mismatch = prev && curr ? namesDisagree(prev, curr) : false

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">A. Records to be unmerged</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mismatch && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <strong>Names differ</strong> between the original record and the new blank record.
            </div>
          </div>
        )}
        <div className="grid grid-cols-[max-content_1fr_1fr_1fr] gap-x-4 gap-y-2 text-sm">
          <div />
          <Header>Original · backup</Header>
          <Header>New blank · live</Header>
          <Header>Wrong recipient · live</Header>
          <Row label="Id" values={[prev?.Id ?? '—', curr?.Id ?? '—', wrong?.Id ?? '—']} mono />
          <Row
            label="Name"
            values={[prev ? fullName(prev) : '—', curr ? fullName(curr) : '—', wrong ? fullName(wrong) : '—']}
          />
          <Row
            label="Email"
            values={[prev?.Email ?? null, curr?.Email ?? null, wrong?.Email ?? null]}
          />
          <Row
            label="Birth"
            values={[prev?.BirthDate ?? null, curr?.BirthDate ?? null, wrong?.BirthDate ?? null]}
          />
          <RowStatus values={[prev, curr, wrong]} />
          <Row
            label="Primary alias id"
            values={[
              prev?.PrimaryAliasId ?? null,
              curr?.PrimaryAliasId ?? null,
              wrong?.PrimaryAliasId ?? null
            ]}
            mono
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Original alias ids:{' '}
          <span className="font-mono">{result.previousAliasIds.join(', ') || '—'}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function Header({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="text-xs uppercase tracking-wide text-muted-foreground">{children}</div>
}

function Row({
  label,
  values,
  mono
}: {
  label: string
  values: Array<string | number | null | undefined>
  mono?: boolean
}): JSX.Element {
  const cls = mono ? 'font-mono text-xs' : ''
  return (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      {values.map((v, i) => (
        <div key={i} className={cls}>
          {v == null || v === '' ? '—' : String(v)}
        </div>
      ))}
    </>
  )
}

function RowStatus({ values }: { values: Array<PersonRecord | null | undefined> }): JSX.Element {
  return (
    <>
      <div className="text-xs text-muted-foreground">Record status</div>
      {values.map((p, i) => (
        <div key={i}>{p ? <StatusPill person={p} /> : '—'}</div>
      ))}
    </>
  )
}

// --- Section B — Tables affected -----------------------------------------

type SortKey = 'tableName' | 'columnName' | 'recordCount' | 'willUpdateCount'

function SectionB({ result }: { result: AnalyzeResult }): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('recordCount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const rows = [...result.affectedTables]
    rows.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [result.affectedTables, sortKey, sortDir])

  const toggleSort = (key: SortKey): void => {
    if (key === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir(key === 'tableName' || key === 'columnName' ? 'asc' : 'desc')
    }
  }

  const exportCsv = (): void => {
    const header = 'Table Name,Column Name,Live Row Count,Will Update Count'
    const lines = sorted.map(
      (r) => `${r.tableName},${r.columnName},${r.recordCount},${r.willUpdateCount}`
    )
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `unmerge-affected-tables-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>B. Tables affected</span>
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={sorted.length === 0}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          <strong>Live</strong> = rows currently referencing the original person's aliases
          (includes any post-merge activity). <strong>Will update</strong> = rows that existed in
          the backup at snapshot time — only those are repointed, per the original SQL script's
          JOIN-by-Id pattern.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No tables affected. Nothing to repoint.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b">
              <tr>
                <ThSort
                  active={sortKey === 'tableName'}
                  dir={sortDir}
                  onClick={() => toggleSort('tableName')}
                >
                  Table
                </ThSort>
                <ThSort
                  active={sortKey === 'columnName'}
                  dir={sortDir}
                  onClick={() => toggleSort('columnName')}
                >
                  Column
                </ThSort>
                <ThSort
                  active={sortKey === 'recordCount'}
                  dir={sortDir}
                  onClick={() => toggleSort('recordCount')}
                  align="right"
                >
                  Live
                </ThSort>
                <ThSort
                  active={sortKey === 'willUpdateCount'}
                  dir={sortDir}
                  onClick={() => toggleSort('willUpdateCount')}
                  align="right"
                >
                  Will update
                </ThSort>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{r.tableName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.columnName}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{r.recordCount}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    <span
                      className={
                        r.willUpdateCount < r.recordCount ? 'text-amber-700 font-semibold' : ''
                      }
                    >
                      {r.willUpdateCount}
                    </span>
                    {r.willUpdateCount < r.recordCount && (
                      <span className="ml-1 text-muted-foreground">
                        ({r.recordCount - r.willUpdateCount} post-merge)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

function ThSort({
  active,
  dir,
  align,
  onClick,
  children
}: {
  active: boolean
  dir: 'asc' | 'desc'
  align?: 'left' | 'right'
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <th
      onClick={onClick}
      className={
        'px-3 py-2 font-medium cursor-pointer select-none ' +
        (align === 'right' ? 'text-right' : '')
      }
    >
      {children}
      {active && <span className="ml-1 text-muted-foreground">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  )
}

// --- Section: profile restore (between B and C) --------------------------

function SectionProfileRestore({ result }: { result: AnalyzeResult }): JSX.Element | null {
  const { personUpdates, mobilePhoneIds } = result.profileRestore
  if (personUpdates.length === 0 && mobilePhoneIds.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Profile basics to restore</CardTitle>
        <p className="text-xs text-muted-foreground">
          Person columns and mobile phone(s) the engine will copy from the backup record onto
          the new blank record.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {personUpdates.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b">
              <tr>
                <th className="px-3 py-2 font-medium">Column</th>
                <th className="px-3 py-2 font-medium">Backup value (will be written)</th>
                <th className="px-3 py-2 font-medium">Current live value</th>
              </tr>
            </thead>
            <tbody>
              {personUpdates.map((u) => (
                <tr key={u.column} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{u.column}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatRestoreValue(u.backupValue)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {formatRestoreValue(u.liveValue)}
                    {u.willOverwrite && (
                      <span className="ml-2 text-amber-700 font-semibold">overwrite</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mobilePhoneIds.length > 0 && (
          <div className="border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">Mobile phones to repoint by Id:</span>{' '}
            <span className="font-mono text-xs">{mobilePhoneIds.join(', ')}</span>{' '}
            <span className="text-xs text-muted-foreground">
              ({mobilePhoneIds.length} row{mobilePhoneIds.length === 1 ? '' : 's'})
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function formatRestoreValue(v: string | number | null): string {
  if (v == null || v === '') return '—'
  return String(v)
}

// --- Section C — Operation summary ---------------------------------------

function SectionC({ result }: { result: AnalyzeResult }): JSX.Element {
  const t = result.totals
  const totalReadIds =
    result.previousAliasIds.length +
    result.groupMemberIds.length +
    result.attributeValueIds.length +
    result.userLoginIds.length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">C. Operation summary</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="GroupMember updates" value={t.groupMemberUpdates} />
          <Stat label="AttributeValue updates" value={t.attributeValueUpdates} />
          <Stat label="UserLogin updates" value={t.userLoginUpdates} />
          <Stat label="History (about-person) updates" value={t.historyEntityUpdates} />
          <Stat label="Alias reference updates" value={t.aliasReferenceUpdates} />
          <Stat label="Profile column updates" value={t.profileColumnUpdates} />
          <Stat label="Mobile phone updates" value={t.mobilePhoneUpdates} />
        </dl>
        <p className="text-xs text-muted-foreground mt-4">
          Read from backup: <span className="font-mono">{result.previousAliasIds.length}</span>{' '}
          aliases · <span className="font-mono">{result.groupMemberIds.length}</span> group
          members · <span className="font-mono">{result.attributeValueIds.length}</span>{' '}
          person attributes · <span className="font-mono">{result.userLoginIds.length}</span>{' '}
          logins · <span className="font-mono">{result.historyAboutPersonIds.length}</span>{' '}
          history-about-person · {totalReadIds + result.historyAboutPersonIds.length} ids total.
        </p>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

// --- Section D — Raw SQL log ---------------------------------------------

function SectionD({ result }: { result: AnalyzeResult }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold w-full text-left"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            D. Raw SQL log ({result.sqlLog.length} statements)
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent>
          <pre className="text-xs font-mono bg-muted/40 rounded p-3 overflow-auto max-h-[40vh] whitespace-pre-wrap">
            {result.sqlLog.join('\n\n')}
          </pre>
        </CardContent>
      )}
    </Card>
  )
}


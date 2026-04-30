import { AlertTriangle, ArrowLeft, Loader2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AnalyzeRequest, PersonRecord } from '@shared/types'
import { fullName, namesDisagree } from '../lib/person-display'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { StatusPill } from './StatusPill'

type Mode = 'name' | 'id'

export interface IdentifyContext {
  previous: PersonRecord
  current: PersonRecord
  wrongRecipient: PersonRecord
}

export interface IdentifyScreenProps {
  onBack: () => void
  onProceed: (req: AnalyzeRequest, ctx: IdentifyContext) => void
}

export function IdentifyScreen({ onBack, onProceed }: IdentifyScreenProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('name')
  const [previous, setPrevious] = useState<PersonRecord | null>(null)
  const [current, setCurrent] = useState<PersonRecord | null>(null)
  const [wrongRecipient, setWrongRecipient] = useState<PersonRecord | null>(null)

  const aliasId = current?.PrimaryAliasId ?? null
  const ready = !!previous && !!current && !!wrongRecipient && aliasId != null

  // Common-sense guard: the wrong-recipient and the new blank must be different
  // people. Catching the obvious copy-paste mistake.
  const sameLivePerson =
    !!current && !!wrongRecipient && current.Id === wrongRecipient.Id

  const proceed = (): void => {
    if (!previous || !current || !wrongRecipient || aliasId == null || sameLivePerson) return
    onProceed(
      {
        previousPersonId: previous.Id,
        currentPersonId: current.Id,
        currentPersonAliasId: aliasId,
        wrongRecipientPersonId: wrongRecipient.Id
      },
      { previous, current, wrongRecipient }
    )
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">Identify the records</h2>
        <p className="text-sm text-muted-foreground">
          The unmerge moves a person's history off the wrong record (where they were merged into
          someone else) and onto a new blank record you've recreated for them. You'll need to
          identify three records:
        </p>
        <ol className="ml-5 list-decimal text-sm text-muted-foreground space-y-1">
          <li>
            <strong>Original record</strong> in the <strong>backup</strong> database — the
            person as they existed before the accidental merge.
          </li>
          <li>
            <strong>New blank record</strong> in the <strong>live (production)</strong> database
            — the empty shell you recreated in Rock to receive their restored history.
          </li>
          <li>
            <strong>Wrong-recipient record</strong> in the <strong>live (production)</strong>{' '}
            database — the person someone was incorrectly merged into. Their record currently
            has the wrong person's history attributed to it.
          </li>
        </ol>
      </header>

      <div className="flex gap-1 border-b">
        <TabButton active={mode === 'name'} onClick={() => setMode('name')}>
          By name
        </TabButton>
        <TabButton active={mode === 'id'} onClick={() => setMode('id')}>
          By ID
        </TabButton>
      </div>

      {mode === 'name' ? (
        <ByNameSearch
          previous={previous}
          current={current}
          wrongRecipient={wrongRecipient}
          setPrevious={setPrevious}
          setCurrent={setCurrent}
          setWrongRecipient={setWrongRecipient}
        />
      ) : (
        <ByIdLookup
          previous={previous}
          current={current}
          wrongRecipient={wrongRecipient}
          setPrevious={setPrevious}
          setCurrent={setCurrent}
          setWrongRecipient={setWrongRecipient}
        />
      )}

      {(previous || current || wrongRecipient) && (
        <ComparisonCard
          previous={previous}
          current={current}
          wrongRecipient={wrongRecipient}
          aliasId={aliasId}
          sameLivePerson={sameLivePerson}
        />
      )}

      <footer className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          {!ready && (
            <span className="text-xs text-muted-foreground">
              Pick all three records (original · new blank · wrong recipient) to continue.
            </span>
          )}
          {ready && current!.PrimaryAliasId == null && (
            <span className="text-xs text-destructive">
              The new blank record has no PrimaryAliasId — recreate their shell in Rock first.
            </span>
          )}
          <Button onClick={proceed} disabled={!ready || sameLivePerson}>
            Next: Preview Impact
          </Button>
        </div>
      </footer>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
        (active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground')
      }
    >
      {children}
    </button>
  )
}

// --- By name --------------------------------------------------------------

function ByNameSearch({
  previous,
  current,
  wrongRecipient,
  setPrevious,
  setCurrent,
  setWrongRecipient
}: {
  previous: PersonRecord | null
  current: PersonRecord | null
  wrongRecipient: PersonRecord | null
  setPrevious: (p: PersonRecord | null) => void
  setCurrent: (p: PersonRecord | null) => void
  setWrongRecipient: (p: PersonRecord | null) => void
}): JSX.Element {
  return (
    <div className="space-y-4">
      <PersonToRestoreSearch
        previous={previous}
        current={current}
        setPrevious={setPrevious}
        setCurrent={setCurrent}
      />
      <WrongRecipientSearch
        wrongRecipient={wrongRecipient}
        setWrongRecipient={setWrongRecipient}
      />
    </div>
  )
}

function PersonToRestoreSearch({
  previous,
  current,
  setPrevious,
  setCurrent
}: {
  previous: PersonRecord | null
  current: PersonRecord | null
  setPrevious: (p: PersonRecord | null) => void
  setCurrent: (p: PersonRecord | null) => void
}): JSX.Element {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [backupRows, setBackupRows] = useState<PersonRecord[] | null>(null)
  const [liveRows, setLiveRows] = useState<PersonRecord[] | null>(null)

  const search = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    if (!first.trim() || !last.trim()) return
    setBusy(true)
    setErr(null)
    setBackupRows(null)
    setLiveRows(null)
    try {
      const [b, l] = await Promise.all([
        window.api.person.searchByName('backup', first.trim(), last.trim()),
        window.api.person.searchByName('live', first.trim(), last.trim())
      ])
      setBackupRows(b)
      setLiveRows(l)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">The person to restore</CardTitle>
        <p className="text-xs text-muted-foreground">
          Search by name. Pick their <strong>original record</strong> from the backup results,
          and their <strong>new blank record</strong> from the live results.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex items-end gap-3" onSubmit={search}>
          <div className="space-y-1">
            <Label>First name</Label>
            <Input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Alice" />
          </div>
          <div className="space-y-1">
            <Label>Last name</Label>
            <Input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Sample" />
          </div>
          <Button type="submit" disabled={busy || !first.trim() || !last.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search both DBs
          </Button>
        </form>
        {err && <p className="text-xs text-destructive">{err}</p>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ResultsTable
            title="Backup — pick the ORIGINAL record"
            subtitle="Their record before the merge"
            rows={backupRows}
            selectedId={previous?.Id ?? null}
            onSelect={setPrevious}
          />
          <ResultsTable
            title="Live — pick the NEW BLANK record"
            subtitle="The empty shell you recreated in Rock"
            rows={liveRows}
            selectedId={current?.Id ?? null}
            onSelect={setCurrent}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function WrongRecipientSearch({
  wrongRecipient,
  setWrongRecipient
}: {
  wrongRecipient: PersonRecord | null
  setWrongRecipient: (p: PersonRecord | null) => void
}): JSX.Element {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [rows, setRows] = useState<PersonRecord[] | null>(null)

  const search = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    if (!first.trim() || !last.trim()) return
    setBusy(true)
    setErr(null)
    setRows(null)
    try {
      const r = await window.api.person.searchByName('live', first.trim(), last.trim())
      setRows(r)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          The profile that received the wrongful merge
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Search live by name. Pick the person whose record currently has the unmerge target's
          history attributed to it.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex items-end gap-3" onSubmit={search}>
          <div className="space-y-1">
            <Label>First name</Label>
            <Input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Bob" />
          </div>
          <div className="space-y-1">
            <Label>Last name</Label>
            <Input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Sample" />
          </div>
          <Button type="submit" disabled={busy || !first.trim() || !last.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search live
          </Button>
        </form>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <ResultsTable
          title="Live — pick the WRONG RECIPIENT"
          subtitle="The person someone was incorrectly merged into"
          rows={rows}
          selectedId={wrongRecipient?.Id ?? null}
          onSelect={setWrongRecipient}
        />
      </CardContent>
    </Card>
  )
}

function ResultsTable({
  title,
  subtitle,
  rows,
  selectedId,
  onSelect
}: {
  title: string
  subtitle?: string
  rows: PersonRecord[] | null
  selectedId: number | null
  onSelect: (p: PersonRecord) => void
}): JSX.Element {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="border-b bg-muted/40 px-3 py-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {subtitle && <div className="text-xs text-muted-foreground/80 mt-0.5">{subtitle}</div>}
      </div>
      {rows == null ? (
        <div className="px-3 py-6 text-xs text-muted-foreground">Run a search to see results.</div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-6 text-xs text-muted-foreground">No matches.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[80px]" />
              <col />
              <col className="w-[88px]" />
              <col />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 font-medium">Id</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Birth</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sel = r.Id === selectedId
                return (
                  <tr
                    key={r.Id}
                    onClick={() => onSelect(r)}
                    className={
                      'cursor-pointer transition-colors ' +
                      (sel ? 'bg-primary/10' : 'hover:bg-muted/50')
                    }
                  >
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.Id}</td>
                    <td className="px-3 py-2 truncate" title={fullName(r)}>
                      {fullName(r)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusPill person={r} />
                    </td>
                    <td
                      className="px-3 py-2 text-muted-foreground truncate"
                      title={r.Email ?? ''}
                    >
                      {r.Email ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {formatBirthDate(r.BirthDate)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// --- By ID ---------------------------------------------------------------

function ByIdLookup({
  previous,
  current,
  wrongRecipient,
  setPrevious,
  setCurrent,
  setWrongRecipient
}: {
  previous: PersonRecord | null
  current: PersonRecord | null
  wrongRecipient: PersonRecord | null
  setPrevious: (p: PersonRecord | null) => void
  setCurrent: (p: PersonRecord | null) => void
  setWrongRecipient: (p: PersonRecord | null) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <IdLookupCard
        role="backup"
        title="Original record · backup"
        helper="The PersonId of the original (pre-merge) record in your backup database."
        person={previous}
        onResolved={setPrevious}
      />
      <IdLookupCard
        role="live"
        title="New blank record · live"
        helper="The PersonId of the empty shell you just created in Rock's web UI."
        person={current}
        onResolved={setCurrent}
      />
      <IdLookupCard
        role="live"
        title="Wrong recipient · live"
        helper="The PersonId of the person who was incorrectly the merge target."
        person={wrongRecipient}
        onResolved={setWrongRecipient}
      />
    </div>
  )
}

function IdLookupCard({
  role,
  title,
  helper,
  person,
  onResolved
}: {
  role: 'live' | 'backup'
  title: string
  helper?: string
  person: PersonRecord | null
  onResolved: (p: PersonRecord | null) => void
}): JSX.Element {
  const [text, setText] = useState(person?.Id?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const lookup = async (): Promise<void> => {
    setErr(null)
    const id = Number(text)
    if (!Number.isInteger(id) || id <= 0) {
      setErr('Enter a positive integer')
      onResolved(null)
      return
    }
    setBusy(true)
    try {
      const p = await window.api.person.getById(role, id)
      if (!p) {
        setErr(`No person with Id=${id} in ${role}`)
        onResolved(null)
      } else {
        onResolved(p)
      }
    } catch (e) {
      setErr((e as Error).message)
      onResolved(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label>Person Id</Label>
            <Input
              type="number"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookup()
              }}
              placeholder="e.g. 2981"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={lookup} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Look up'}
          </Button>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        {person && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{fullName(person)}</span>
              <StatusPill person={person} />
            </div>
            <div className="text-muted-foreground">
              Id <span className="font-mono">{person.Id}</span> · alias{' '}
              <span className="font-mono">{person.PrimaryAliasId ?? '—'}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// --- Comparison card ------------------------------------------------------

function ComparisonCard({
  previous,
  current,
  wrongRecipient,
  aliasId,
  sameLivePerson
}: {
  previous: PersonRecord | null
  current: PersonRecord | null
  wrongRecipient: PersonRecord | null
  aliasId: number | null
  sameLivePerson: boolean
}): JSX.Element {
  const [bothNamesSet, setBothNamesSet] = useState(false)
  useEffect(() => {
    setBothNamesSet(!!previous && !!current)
  }, [previous, current])

  const mismatch = previous && current ? namesDisagree(previous, current) : false

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Selection</span>
          {bothNamesSet && aliasId != null && (
            <span className="text-xs text-muted-foreground">
              New blank record's PersonAliasId auto-resolved:{' '}
              <span className="font-mono text-foreground">{aliasId}</span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sameLivePerson && (
          <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <strong>Same live person picked twice.</strong> The new blank record and the
              wrong-recipient record must be different people in the live database.
            </div>
          </div>
        )}
        {mismatch && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <strong>Names differ</strong> between the original record and the new blank record.
              Confirm these are the same person before proceeding — running the unmerge on
              mismatched records will attribute one person's history to another.
            </div>
          </div>
        )}
        <div className="grid grid-cols-[max-content_1fr_1fr_1fr] gap-x-4 gap-y-2 text-sm">
          <div />
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Original · backup
          </div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            New blank · live
          </div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Wrong recipient · live
          </div>
          <Field
            label="Id"
            values={[previous?.Id ?? '—', current?.Id ?? '—', wrongRecipient?.Id ?? '—']}
            mono
          />
          <Field
            label="First name"
            values={[previous?.FirstName, current?.FirstName, wrongRecipient?.FirstName]}
          />
          <Field
            label="Last name"
            values={[previous?.LastName, current?.LastName, wrongRecipient?.LastName]}
          />
          <Field
            label="Nick name"
            values={[previous?.NickName, current?.NickName, wrongRecipient?.NickName]}
          />
          <Field
            label="Email"
            values={[previous?.Email, current?.Email, wrongRecipient?.Email]}
          />
          <Field
            label="Birth date"
            values={[
              formatBirthDate(previous?.BirthDate),
              formatBirthDate(current?.BirthDate),
              formatBirthDate(wrongRecipient?.BirthDate)
            ]}
          />
          <Field
            label="Gender"
            values={[
              previous?.Gender ?? null,
              current?.Gender ?? null,
              wrongRecipient?.Gender ?? null
            ]}
            mono
          />
          <FieldStatus
            label="Record status"
            values={[previous, current, wrongRecipient]}
          />
          <Field
            label="Connection status"
            values={[
              previous?.ConnectionStatusValueId ?? null,
              current?.ConnectionStatusValueId ?? null,
              wrongRecipient?.ConnectionStatusValueId ?? null
            ]}
            mono
          />
          <Field
            label="Created"
            values={[previous?.CreatedDateTime, current?.CreatedDateTime, wrongRecipient?.CreatedDateTime]}
          />
          <Field
            label="Modified"
            values={[previous?.ModifiedDateTime, current?.ModifiedDateTime, wrongRecipient?.ModifiedDateTime]}
          />
          <Field
            label="Primary alias id"
            values={[
              previous?.PrimaryAliasId ?? null,
              current?.PrimaryAliasId ?? null,
              wrongRecipient?.PrimaryAliasId ?? null
            ]}
            mono
          />
        </div>
      </CardContent>
    </Card>
  )
}

function Field({
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
          {display(v)}
        </div>
      ))}
    </>
  )
}

function FieldStatus({
  label,
  values
}: {
  label: string
  values: Array<PersonRecord | null>
}): JSX.Element {
  return (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      {values.map((p, i) => (
        <div key={i}>{p ? <StatusPill person={p} /> : '—'}</div>
      ))}
    </>
  )
}

function display(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  return String(v)
}

/** Format BirthDate as MM/DD/YYYY for display. Accepts an ISO datetime
 *  ("1990-04-12T00:00:00.000Z") or a date-only string ("1990-04-12"). Falls
 *  back to the raw value if it doesn't look like a parseable date. */
function formatBirthDate(v: string | null | undefined): string {
  if (v == null || v === '') return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return v
  const [, year, month, day] = m
  return `${month}/${day}/${year}`
}

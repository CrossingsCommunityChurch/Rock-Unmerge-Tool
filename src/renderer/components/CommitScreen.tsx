import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Loader2,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AnalyzeRequest,
  AnalyzeResult,
  AppMode,
  CommitResult,
  PersonRecord,
  UnmergeProgress
} from '@shared/types'
import { fullName } from '../lib/person-display'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

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
  'finalize-rollback': 'Rolling back (this should not happen on commit)',
  'finalize-commit': 'Committing transaction'
}

export interface CommitScreenProps {
  request: AnalyzeRequest
  analyzeResult: AnalyzeResult
  previousPerson: PersonRecord | null
  onBack: () => void
  onSuccess: (result: CommitResult) => void
}

export function CommitScreen(props: CommitScreenProps): JSX.Element {
  const { request, analyzeResult, previousPerson, onBack, onSuccess } = props

  const [mode, setMode] = useState<AppMode>('production')
  const [haveBackup, setHaveBackup] = useState(false)
  const [reviewedPreview, setReviewedPreview] = useState(false)
  const [understandUndo, setUnderstandUndo] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<UnmergeProgress | null>(null)
  const [progressLog, setProgressLog] = useState<UnmergeProgress[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.app.getMode().then(setMode)
  }, [])

  const referencePerson = previousPerson ?? analyzeResult.backupPerson
  const expectedName = useMemo(
    () => (referencePerson ? fullName(referencePerson) : ''),
    [referencePerson]
  )
  const nameMatches =
    expectedName.length > 0 &&
    confirmName.trim().toLowerCase() === expectedName.toLowerCase()

  // In test mode the "I have a backup" check doesn't apply — the test SQLite
  // files are the whole world. Drop it in test mode but require the other two.
  const checksOk =
    mode === 'test'
      ? reviewedPreview && understandUndo
      : haveBackup && reviewedPreview && understandUndo

  const ready = checksOk && nameMatches && !busy

  const verificationOk = analyzeResult.verification.matchesWrongRecipient

  const doCommit = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setError(null)
    setProgress(null)
    setProgressLog([])
    const unsub = window.api.unmerge.onProgress((e) => {
      setProgress(e)
      setProgressLog((p) => [...p, e])
    })
    try {
      const result = await window.api.unmerge.commit(request)
      onSuccess(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      unsub()
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Commit changes</h2>
        <p className="text-sm text-muted-foreground">
          Review, acknowledge, and run the unmerge against the live database.
        </p>
      </header>

      {mode === 'production' ? (
        <>
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
              <Database className="h-4 w-4 mt-0.5" />
              <div>
                <strong>This action will modify your LIVE database.</strong>{' '}
                Have you taken a fresh backup of the live database since identifying these
                records? If anything goes wrong, the backup is your only restore path.
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-500/40 bg-amber-50/50">
            <CardContent className="flex items-start gap-2 p-4 text-sm text-amber-900">
              <ShieldAlert className="h-4 w-4 mt-0.5" />
              <div>
                <strong>PITR-vs-PITR validation recommended.</strong>{' '}
                Have you walked this exact workflow through against two point-in-time-restore
                copies (test live + earlier backup) before pointing at production?
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-yellow-500/40 bg-yellow-50/50">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-yellow-900">
            <ShieldCheck className="h-4 w-4 mt-0.5" />
            <div>
              <strong>Test database — safe to proceed.</strong>{' '}
              The commit will run against the synthetic SQLite files only. No real Rock data
              is involved.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">What will happen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Recap result={analyzeResult} expectedName={expectedName} />
          {!verificationOk && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <div>
                <strong>Verification did not pass.</strong>{' '}
                {analyzeResult.verification.message ??
                  'The original aliases did not match the wrong-recipient cleanly.'}{' '}
                Re-check your selections on the Identify step before committing.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Required acknowledgments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {mode === 'production' && (
            <CheckRow
              checked={haveBackup}
              onChange={setHaveBackup}
              label="I have taken a current backup of the live database."
            />
          )}
          <CheckRow
            checked={reviewedPreview}
            onChange={setReviewedPreview}
            label="I have reviewed the impact preview and the affected records look correct."
          />
          <CheckRow
            checked={understandUndo}
            onChange={setUnderstandUndo}
            label="I understand this operation cannot be automatically undone."
          />

          <div className="space-y-1 pt-2 border-t">
            <label className="text-xs text-muted-foreground">
              Type the original person's full name to confirm:{' '}
              <span className="font-mono text-foreground">{expectedName || '—'}</span>
            </label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={expectedName}
              disabled={busy || !expectedName}
              autoComplete="off"
              spellCheck={false}
            />
            {confirmName && !nameMatches && (
              <p className="text-xs text-destructive">Name doesn't match yet.</p>
            )}
            {nameMatches && (
              <p className="text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Match
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {progress && (
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-medium">{STEP_LABELS[progress.step] ?? progress.step}</span>
            </div>
            {progress.detail && (
              <div className="text-xs text-muted-foreground">{progress.detail}</div>
            )}
            {progressLog.length > 1 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground/80">
                {progressLog.slice(0, -1).map((e, i) => (
                  <li key={i}>✓ {STEP_LABELS[e.step] ?? e.step}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <div className="font-medium">Commit failed</div>
              <div className="font-mono text-xs whitespace-pre-wrap">{error}</div>
              <div className="mt-2 text-xs">
                The transaction was rolled back. An audit log was written; check the audit-logs
                folder from the gear menu for details.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <footer className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          {!ready && !busy && (
            <span className="text-xs text-muted-foreground">
              Complete the acknowledgments and type the name to enable commit.
            </span>
          )}
          <Button
            onClick={doCommit}
            disabled={!ready}
            variant="destructive"
            size="lg"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === 'test' ? 'Commit (test mode)' : 'Commit Changes'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

function CheckRow({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (b: boolean) => void
  label: string
}): JSX.Element {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

function Recap({
  result,
  expectedName
}: {
  result: AnalyzeResult
  expectedName: string
}): JSX.Element {
  const t = result.totals
  return (
    <ul className="ml-5 list-disc space-y-1">
      <li>
        Move <strong>{expectedName || 'the original person'}</strong>'s history off PersonId{' '}
        <span className="font-mono">{result.wrongRecipientPerson?.Id ?? '—'}</span> and onto
        PersonId <span className="font-mono">{result.livePerson?.Id ?? '—'}</span>.
      </li>
      <li>
        Update <strong>{t.groupMemberUpdates}</strong> GroupMember row(s),{' '}
        <strong>{t.attributeValueUpdates}</strong> AttributeValue row(s),{' '}
        <strong>{t.userLoginUpdates}</strong> UserLogin row(s),{' '}
        <strong>{t.historyEntityUpdates}</strong> History row(s) about the person,
        and <strong>{t.aliasReferenceUpdates}</strong> alias reference(s) across{' '}
        {result.affectedTables.length} table(s).
      </li>
      {(result.profileRestore.personUpdates.length > 0 ||
        result.profileRestore.mobilePhoneIds.length > 0) && (
        <li>
          Restore <strong>{result.profileRestore.personUpdates.length}</strong> profile column(s)
          {' '}and <strong>{result.profileRestore.mobilePhoneIds.length}</strong> mobile phone row(s)
          {' '}from backup onto the new blank record.
        </li>
      )}
      <li>All writes happen in a single transaction on the live connection.</li>
    </ul>
  )
}

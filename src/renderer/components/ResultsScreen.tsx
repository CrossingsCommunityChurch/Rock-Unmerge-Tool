import { CheckCircle2, Download, FileText, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import type { CommitResult } from '@shared/types'
import { fullName } from '../lib/person-display'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Dialog } from './ui/dialog'

export interface ResultsScreenProps {
  result: CommitResult
  onStartAnother: () => void
}

export function ResultsScreen({ result, onStartAnother }: ResultsScreenProps): JSX.Element {
  const [showCelebration, setShowCelebration] = useState(true)

  const downloadOperationLog = (): void => {
    const lines: string[] = []
    lines.push(`# Rock Unmerge -- operation log`)
    lines.push(`Started:  ${result.startedAt}`)
    lines.push(`Finished: ${result.finishedAt}`)
    lines.push(`Status:   ${result.committed ? 'COMMITTED' : 'NOT COMMITTED'}`)
    lines.push('')
    lines.push('## SQL log')
    for (let i = 0; i < result.sqlLog.length; i++) {
      lines.push(`-- statement ${i + 1}`)
      lines.push(result.sqlLog[i])
      lines.push('')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.auditLogFilename ?? `unmerge-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <Dialog open={showCelebration} onClose={() => setShowCelebration(false)}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold leading-tight">Unmerge complete</h3>
              <p className="text-sm text-muted-foreground">
                The transaction committed successfully.
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            An audit log has been written for this run. Verify the restored record in Rock when
            convenient.
          </p>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setShowCelebration(false)}>View summary</Button>
          </div>
        </div>
      </Dialog>

      <header>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          Unmerge committed
        </h2>
        <p className="text-sm text-muted-foreground">
          {fullName(result.backupPerson ?? { FirstName: '?', LastName: '?' } as never)}'s history
          has been moved off PersonId{' '}
          <span className="font-mono">{result.wrongRecipientPerson?.Id ?? '—'}</span> and onto
          PersonId <span className="font-mono">{result.livePerson?.Id ?? '—'}</span>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="GroupMember updates" value={result.totals.groupMemberUpdates} />
            <Stat label="AttributeValue updates" value={result.totals.attributeValueUpdates} />
            <Stat label="UserLogin updates" value={result.totals.userLoginUpdates} />
            <Stat label="History (about-person)" value={result.totals.historyEntityUpdates} />
            <Stat label="Alias reference updates" value={result.totals.aliasReferenceUpdates} />
            <Stat label="Profile column updates" value={result.totals.profileColumnUpdates} />
            <Stat label="Mobile phone updates" value={result.totals.mobilePhoneUpdates} />
          </dl>
          <p className="text-xs text-muted-foreground mt-4">
            Started {result.startedAt} · finished {result.finishedAt} · status{' '}
            <span className="font-mono">{result.committed ? 'COMMITTED' : 'NOT COMMITTED'}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> Audit log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {result.auditLogPath ? (
            <>
              <div className="text-xs text-muted-foreground">Written to:</div>
              <div className="font-mono text-xs break-all bg-muted/40 rounded p-2">
                {result.auditLogPath}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => window.api.app.openAuditDir()}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open folder
                </Button>
                <Button size="sm" variant="ghost" onClick={downloadOperationLog}>
                  <Download className="h-3.5 w-3.5" /> Download .txt copy
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">Audit log path was not returned.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Verify in Rock</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p className="text-muted-foreground">Spot-check the unmerge worked end-to-end:</p>
          <ul className="ml-5 list-disc text-sm space-y-1">
            <li>
              Open the restored person's record in Rock — their attendance, giving, and group
              memberships should now show.
            </li>
            <li>
              Open the wrong-recipient's record — the restored person's history should no
              longer be attributed to them.
            </li>
            <li>
              Confirm the restored person's user login (if any) signs them in correctly.
            </li>
            <li>
              Check family memberships — these are intentionally NOT moved by the unmerge; you
              may need to adjust family memberships manually if the restored person belongs in
              their original family.
            </li>
            <li>
              Any post-merge activity (rows created against the wrong-recipient AFTER the
              accidental merge) was left in place by design. Review the "post-merge" rows in
              the affected-tables list and re-attribute manually if needed.
            </li>
          </ul>
        </CardContent>
      </Card>

      <footer className="flex items-center justify-end gap-3 pt-2">
        <Button variant="ghost" onClick={() => window.close()}>
          Close
        </Button>
        <Button onClick={onStartAnother}>Start Another Unmerge</Button>
      </footer>
    </div>
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

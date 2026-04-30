import { CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TestDbStatus } from '@shared/types'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

export interface TestModePanelProps {
  onReady: (status: TestDbStatus) => void
}

export function TestModePanel({ onReady }: TestModePanelProps): JSX.Element {
  const [status, setStatus] = useState<TestDbStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const s = await window.api.testMode.getStatus()
    setStatus(s)
    if (s.exists) onReady(s)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const create = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const s = await window.api.testMode.create()
      setStatus(s)
      onReady(s)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const s = await window.api.testMode.reset()
      setStatus(s)
      onReady(s)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const teardown = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      await window.api.testMode.teardown()
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test databases (SQLite)</CardTitle>
        <CardDescription>
          Synthetic, throwaway databases seeded with an Alice-merged-into-Bob scenario. Safe to
          run any operation against — no Rock data is touched.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status?.exists ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Test databases exist
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>Live</dt>
              <dd className="font-mono break-all">{status.livePath}</dd>
              <dt>Backup</dt>
              <dd className="font-mono break-all">{status.backupPath}</dd>
            </dl>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={reset} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Reset Test Data
              </Button>
              <Button size="sm" variant="ghost" onClick={teardown} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              No test databases yet. Click below to create them.
            </p>
            <Button onClick={create} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Test Databases
            </Button>
          </div>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  )
}

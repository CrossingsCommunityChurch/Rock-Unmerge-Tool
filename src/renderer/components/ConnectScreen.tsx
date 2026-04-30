import { CheckCircle2, Info, Loader2, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  AppMode,
  ConnectionConfig,
  ConnectionTestResult,
  CrossDbProbeResult,
  SavedProfile,
  TestDbStatus
} from '@shared/types'
import { ConnectionForm } from './ConnectionForm'
import { TestModePanel } from './TestModePanel'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'

export interface ConnectScreenProps {
  mode: AppMode
  liveCfg: ConnectionConfig
  backupCfg: ConnectionConfig
  setLiveCfg: (c: ConnectionConfig) => void
  setBackupCfg: (c: ConnectionConfig) => void
  liveResult: ConnectionTestResult | undefined
  backupResult: ConnectionTestResult | undefined
  setLiveResult: (r: ConnectionTestResult | undefined) => void
  setBackupResult: (r: ConnectionTestResult | undefined) => void
  onProceed: () => void
}

export function ConnectScreen(props: ConnectScreenProps): JSX.Element {
  const {
    mode,
    liveCfg,
    backupCfg,
    setLiveCfg,
    setBackupCfg,
    liveResult,
    backupResult,
    setLiveResult,
    setBackupResult,
    onProceed
  } = props

  const [testingLive, setTestingLive] = useState(false)
  const [testingBackup, setTestingBackup] = useState(false)

  const testLive = async (): Promise<void> => {
    setTestingLive(true)
    setLiveResult(undefined)
    try {
      setLiveResult(await window.api.connection.test({ ...liveCfg, role: 'live' }))
    } finally {
      setTestingLive(false)
    }
  }
  const testBackup = async (): Promise<void> => {
    setTestingBackup(true)
    setBackupResult(undefined)
    try {
      setBackupResult(await window.api.connection.test({ ...backupCfg, role: 'backup' }))
    } finally {
      setTestingBackup(false)
    }
  }

  const bothOk = !!(liveResult?.ok && backupResult?.ok)

  // Auto-test in test mode after the test DBs become available
  const handleTestDbsReady = async (status: TestDbStatus): Promise<void> => {
    if (!status.exists) return
    await Promise.all([testLive(), testBackup()])
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Connect to your databases</h2>
        <p className="text-sm text-muted-foreground">
          {mode === 'test'
            ? 'Test mode uses synthetic SQLite files. No real Rock data is involved.'
            : 'Live = the production Rock database. Backup = a point-in-time-restore taken before the accidental merge.'}
        </p>
      </header>

      {mode === 'test' ? (
        <>
          <TestModePanel onReady={handleTestDbsReady} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TestModeConnectionStatus
              role="live"
              result={liveResult}
              testing={testingLive}
              onTest={testLive}
            />
            <TestModeConnectionStatus
              role="backup"
              result={backupResult}
              testing={testingBackup}
              onTest={testBackup}
            />
          </div>
        </>
      ) : (
        <>
          <ProfileBar
            liveCfg={liveCfg}
            backupCfg={backupCfg}
            setLiveCfg={setLiveCfg}
            setBackupCfg={setBackupCfg}
            onLoaded={() => {
              setLiveResult(undefined)
              setBackupResult(undefined)
            }}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConnectionForm
              role="live"
              value={liveCfg}
              onChange={setLiveCfg}
              testResult={liveResult}
              testing={testingLive}
              onTest={testLive}
            />
            <ConnectionForm
              role="backup"
              value={backupCfg}
              onChange={setBackupCfg}
              testResult={backupResult}
              testing={testingBackup}
              onTest={testBackup}
            />
          </div>
          {bothOk && <CrossDbProbeBanner liveCfg={liveCfg} backupDb={backupCfg.database} />}
        </>
      )}

      <footer className="flex items-center justify-end gap-3 pt-2">
        <span className="text-xs text-muted-foreground">
          {bothOk ? 'Both connections verified.' : 'Both connections must succeed to proceed.'}
        </span>
        <Button onClick={onProceed} disabled={!bothOk}>
          Next: Identify Person
        </Button>
      </footer>
    </div>
  )
}

function TestModeConnectionStatus({
  role,
  result,
  testing,
  onTest
}: {
  role: 'live' | 'backup'
  result: ConnectionTestResult | undefined
  testing: boolean
  onTest: () => void
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{role === 'live' ? 'Live (test SQLite)' : 'Backup (test SQLite)'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {testing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> testing…
          </div>
        )}
        {result?.ok && (
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> connected
            </div>
            <div className="text-xs text-muted-foreground">
              Person rows: <span className="font-mono">{result.personRowCount}</span>
            </div>
          </div>
        )}
        {result && !result.ok && (
          <p className="text-xs text-destructive">{result.errorMessage}</p>
        )}
        <Button size="sm" variant="secondary" onClick={onTest} disabled={testing}>
          Test Connection
        </Button>
      </CardContent>
    </Card>
  )
}

function CrossDbProbeBanner({
  liveCfg,
  backupDb
}: {
  liveCfg: ConnectionConfig
  backupDb: string
}): JSX.Element {
  const [result, setResult] = useState<CrossDbProbeResult | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await window.api.connection.crossDbProbe({ ...liveCfg, role: 'live' }, backupDb)
        if (!cancelled) setResult(r)
      } catch (e) {
        if (!cancelled) setResult({ ok: false, errorMessage: (e as Error).message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [liveCfg, backupDb])

  if (!result) return <div />
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">Cross-database probe</div>
          <p className="text-muted-foreground">
            {result.ok
              ? 'Three-part-name queries are supported on this server. The tool will still use bridge mode for consistency.'
              : (result.errorMessage ?? 'Probe failed (bridge mode is used regardless).')}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function ProfileBar({
  liveCfg,
  backupCfg,
  setLiveCfg,
  setBackupCfg,
  onLoaded
}: {
  liveCfg: ConnectionConfig
  backupCfg: ConnectionConfig
  setLiveCfg: (c: ConnectionConfig) => void
  setBackupCfg: (c: ConnectionConfig) => void
  onLoaded: () => void
}): JSX.Element {
  const [profiles, setProfiles] = useState<SavedProfile[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setProfiles(await window.api.profile.list())
  }
  useEffect(() => {
    void refresh()
  }, [])

  const load = async (id: string): Promise<void> => {
    if (!id) return
    setBusy(true)
    setErr(null)
    try {
      const { live, backup } = await window.api.profile.load(id)
      setLiveCfg({ ...live, role: 'live' })
      setBackupCfg({ ...backup, role: 'backup' })
      setSelectedId(id)
      onLoaded()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await window.api.profile.save(name.trim(), liveCfg, backupCfg)
      setName('')
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    setBusy(true)
    try {
      await window.api.profile.delete(selectedId)
      setSelectedId('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-3 p-4 items-end">
        <div className="space-y-1">
          <Label>Load saved profile</Label>
          <Select value={selectedId} onChange={(e) => void load(e.target.value)} disabled={busy}>
            <option value="">— choose —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.live.server} · {p.backup.server})
              </option>
            ))}
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={remove} disabled={!selectedId || busy}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
        <div className="space-y-1">
          <Label>Save current as profile</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Rock prod + 2025-04-12 PITR"
          />
        </div>
        <Button onClick={save} disabled={!name.trim() || busy} size="sm">
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
        {err && <p className="col-span-full text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  )
}

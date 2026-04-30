import { Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Api } from '../preload'
import type {
  AnalyzeRequest,
  AnalyzeResult,
  AppMode,
  CommitResult,
  ConnectionConfig,
  ConnectionTestResult,
  PersonRecord
} from '@shared/types'
import { CommitScreen } from './components/CommitScreen'
import { ConnectScreen } from './components/ConnectScreen'
import { IdentifyScreen } from './components/IdentifyScreen'
import { PreviewScreen } from './components/PreviewScreen'
import { ResultsScreen } from './components/ResultsScreen'
import { Button } from './components/ui/button'
import { defaultConnection } from './lib/defaults'

declare global {
  interface Window {
    api: Api
  }
}

type Step = 'connect' | 'identify' | 'preview' | 'commit' | 'results'

export function App(): JSX.Element {
  const [mode, setMode] = useState<AppMode>('production')
  const [step, setStep] = useState<Step>('connect')
  const [showSettings, setShowSettings] = useState(false)

  const [liveCfg, setLiveCfg] = useState<ConnectionConfig>(() => defaultConnection('live'))
  const [backupCfg, setBackupCfg] = useState<ConnectionConfig>(() => defaultConnection('backup'))
  const [liveResult, setLiveResult] = useState<ConnectionTestResult | undefined>()
  const [backupResult, setBackupResult] = useState<ConnectionTestResult | undefined>()

  const [analyzeReq, setAnalyzeReq] = useState<AnalyzeRequest | null>(null)
  const [previousPerson, setPreviousPerson] = useState<PersonRecord | null>(null)
  const [currentPerson, setCurrentPerson] = useState<PersonRecord | null>(null)
  const [wrongRecipientPerson, setWrongRecipientPerson] = useState<PersonRecord | null>(null)
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)

  const startAnother = (): void => {
    setAnalyzeReq(null)
    setPreviousPerson(null)
    setCurrentPerson(null)
    setWrongRecipientPerson(null)
    setAnalyzeResult(null)
    setCommitResult(null)
    setStep('identify')
  }

  useEffect(() => {
    void window.api.app.getMode().then(setMode)
  }, [])

  const toggleMode = async (): Promise<void> => {
    const next: AppMode = mode === 'production' ? 'test' : 'production'
    await window.api.app.setMode(next)
    setMode(next)
    // Clear test results when switching modes — they're not comparable.
    setLiveResult(undefined)
    setBackupResult(undefined)
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {mode === 'test' && (
        <div className="bg-yellow-400 text-yellow-950 text-center py-1.5 text-sm font-semibold tracking-wide">
          TEST MODE — operations target synthetic SQLite databases (safe to proceed)
        </div>
      )}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">
            Rock Unmerge Tool{mode === 'test' ? ' — TEST MODE' : ''}
          </h1>
          <span className="text-xs text-muted-foreground">
            {liveResult?.ok && backupResult?.ok && mode === 'production'
              ? `Live: ${liveCfg.server}/${liveCfg.database} · Backup: ${backupCfg.server}/${backupCfg.database}`
              : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Stepper current={step} />
          <Button variant="ghost" size="sm" onClick={() => setShowSettings((v) => !v)}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {showSettings && (
        <div className="border-b bg-muted/30 px-6 py-3 flex items-center gap-3">
          <span className="text-sm">Mode:</span>
          <Button size="sm" variant={mode === 'production' ? 'default' : 'outline'} onClick={toggleMode}>
            {mode === 'production' ? 'Production (active)' : 'Switch to Production'}
          </Button>
          <Button size="sm" variant={mode === 'test' ? 'default' : 'outline'} onClick={toggleMode}>
            {mode === 'test' ? 'Test (active)' : 'Switch to Test Mode'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.api.app.openAuditDir()}>
            Open audit-log folder
          </Button>
        </div>
      )}

      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {step === 'connect' && (
            <ConnectScreen
              mode={mode}
              liveCfg={liveCfg}
              backupCfg={backupCfg}
              setLiveCfg={setLiveCfg}
              setBackupCfg={setBackupCfg}
              liveResult={liveResult}
              backupResult={backupResult}
              setLiveResult={setLiveResult}
              setBackupResult={setBackupResult}
              onProceed={async () => {
                await window.api.session.set(liveCfg, backupCfg)
                setStep('identify')
              }}
            />
          )}
          {step === 'identify' && (
            <IdentifyScreen
              onBack={() => setStep('connect')}
              onProceed={(req, ctx) => {
                setAnalyzeReq(req)
                setPreviousPerson(ctx.previous)
                setCurrentPerson(ctx.current)
                setWrongRecipientPerson(ctx.wrongRecipient)
                setStep('preview')
              }}
            />
          )}
          {step === 'preview' && analyzeReq && (
            <PreviewScreen
              request={analyzeReq}
              previousPerson={previousPerson}
              currentPerson={currentPerson}
              wrongRecipientPerson={wrongRecipientPerson}
              onBack={() => setStep('identify')}
              onProceed={(result) => {
                setAnalyzeResult(result)
                setStep('commit')
              }}
            />
          )}
          {step === 'preview' && !analyzeReq && (
            <div className="rounded-md border p-6 text-sm text-muted-foreground space-y-2">
              <div>No identify selection found — go back and pick records first.</div>
              <Button variant="ghost" size="sm" onClick={() => setStep('identify')}>
                ← Back to Identify
              </Button>
            </div>
          )}
          {step === 'commit' && analyzeReq && analyzeResult && (
            <CommitScreen
              request={analyzeReq}
              analyzeResult={analyzeResult}
              previousPerson={previousPerson}
              onBack={() => setStep('preview')}
              onSuccess={(result) => {
                setCommitResult(result)
                setStep('results')
              }}
            />
          )}
          {step === 'commit' && (!analyzeReq || !analyzeResult) && (
            <div className="rounded-md border p-6 text-sm text-muted-foreground space-y-2">
              <div>No analyze result in memory — run the preview first.</div>
              <Button variant="ghost" size="sm" onClick={() => setStep('preview')}>
                ← Back to Preview
              </Button>
            </div>
          )}
          {step === 'results' && commitResult && (
            <ResultsScreen result={commitResult} onStartAnother={startAnother} />
          )}
          {step === 'results' && !commitResult && (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">
              No commit result in memory.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function Stepper({ current }: { current: Step }): JSX.Element {
  const steps: Array<{ id: Step; label: string }> = [
    { id: 'connect', label: '1. Connect' },
    { id: 'identify', label: '2. Identify' },
    { id: 'preview', label: '3. Preview' },
    { id: 'commit', label: '4. Commit' },
    { id: 'results', label: '5. Results' }
  ]
  const idx = steps.findIndex((s) => s.id === current)
  return (
    <ol className="flex items-center gap-1 text-xs text-muted-foreground">
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={
            i === idx
              ? 'rounded bg-primary text-primary-foreground px-2 py-1 font-medium'
              : i < idx
                ? 'text-foreground/60 px-2 py-1'
                : 'px-2 py-1'
          }
        >
          {s.label}
        </li>
      ))}
    </ol>
  )
}

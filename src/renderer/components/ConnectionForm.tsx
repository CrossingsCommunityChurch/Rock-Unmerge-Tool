import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { ConnectionConfig, ConnectionTestResult } from '@shared/types'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'

export interface ConnectionFormProps {
  role: 'live' | 'backup'
  value: ConnectionConfig
  onChange: (cfg: ConnectionConfig) => void
  testResult?: ConnectionTestResult
  testing: boolean
  onTest: () => void
}

export function ConnectionForm(props: ConnectionFormProps): JSX.Element {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const { role, value, onChange, testResult, testing, onTest } = props
  const set = <K extends keyof ConnectionConfig>(key: K, v: ConnectionConfig[K]): void =>
    onChange({ ...value, [key]: v })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{role === 'live' ? 'Live Database' : 'Backup Database'}</span>
          <StatusPill testing={testing} result={testResult} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Server">
          <Input
            value={value.server}
            placeholder="server.database.windows.net"
            onChange={(e) => set('server', e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port">
            <Input
              type="number"
              value={value.port}
              onChange={(e) => set('port', Number(e.target.value) || 1433)}
            />
          </Field>
          <Field label="Database">
            <Input
              value={value.database}
              placeholder="rockrms"
              onChange={(e) => set('database', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Authentication">
          <Select
            value={value.authentication}
            onChange={(e) => set('authentication', e.target.value as ConnectionConfig['authentication'])}
          >
            <option value="sql">SQL Authentication</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username">
            <Input
              value={value.username ?? ''}
              autoComplete="off"
              onChange={(e) => set('username', e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={value.password ?? ''}
              autoComplete="new-password"
              onChange={(e) => set('password', e.target.value)}
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
        </button>
        {showAdvanced && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <CheckRow
              label="Encrypt connection (required for Azure SQL)"
              checked={value.encrypt}
              onChange={(b) => set('encrypt', b)}
            />
            <CheckRow
              label="Trust server certificate (development only)"
              checked={value.trustServerCertificate}
              onChange={(b) => set('trustServerCertificate', b)}
            />
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={onTest} disabled={testing} variant="secondary" size="sm">
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Test Connection
          </Button>
          {testResult && !testResult.ok && (
            <span className="text-xs text-destructive">
              {String(testResult.errorCode ?? '')} {testResult.errorMessage}
            </span>
          )}
          {testResult && testResult.ok && (
            <span className="text-xs text-muted-foreground">
              Person rows: <span className="font-mono">{testResult.personRowCount ?? '—'}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function CheckRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (b: boolean) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function StatusPill({
  testing,
  result
}: {
  testing: boolean
  result: ConnectionTestResult | undefined
}): JSX.Element | null {
  if (testing) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> testing…
      </span>
    )
  }
  if (!result) return null
  if (result.ok) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 className="h-4 w-4" /> connected
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-destructive">
      <XCircle className="h-4 w-4" /> failed
    </span>
  )
}

// Connection manager — owns the adapter lifecycle and the production-vs-test
// switch. Renderer-facing IPC handlers call into this module; the unmerge
// engine is handed pre-opened adapters by it.

import type { ConnectionConfig, ConnectionTestResult, CrossDbProbeResult } from '@shared/types'
import {
  isCrossDbNotSupportedError,
  isPausedServerlessError,
  MssqlAdapter
} from './adapters/mssql-adapter'
import { SqliteAdapter } from './adapters/sqlite-adapter'
import type { DatabaseAdapter } from './adapters/database-adapter'
import { getTestDbStatus, testDbPaths } from './test-mode/test-db-manager'
import { getAppMode } from './app-mode'

export async function testConnection(cfg: ConnectionConfig): Promise<ConnectionTestResult> {
  if (getAppMode() === 'test') {
    return testTestModeConnection(cfg.role)
  }
  return testProductionConnection(cfg)
}

async function testTestModeConnection(role: 'live' | 'backup'): Promise<ConnectionTestResult> {
  const status = getTestDbStatus()
  if (!status.exists) {
    return {
      ok: false,
      errorCode: 'TEST_DB_NOT_CREATED',
      errorMessage:
        'Test databases have not been created yet. Click "Create Test Databases" first.'
    }
  }
  const path = role === 'live' ? status.livePath! : status.backupPath!
  const adapter = new SqliteAdapter(path, {
    label: `sqlite:${role}`,
    readonly: role === 'backup'
  })
  try {
    await adapter.connect()
    const v = await adapter.query<{ v: string }>(`SELECT 'SQLite test database' AS v`)
    const c = await adapter.query<{ n: number }>(`SELECT COUNT(*) AS n FROM [Person]`)
    return {
      ok: true,
      serverVersion: v.rows[0]?.v ?? 'SQLite',
      personRowCount: c.rows[0]?.n ?? 0
    }
  } catch (err) {
    return mapError(err)
  } finally {
    await adapter.close()
  }
}

async function testProductionConnection(cfg: ConnectionConfig): Promise<ConnectionTestResult> {
  const adapter = new MssqlAdapter(cfg, {
    label: `${cfg.role}:test-connection`,
    readOnlyIntent: cfg.role === 'backup'
  })
  try {
    await adapter.connect()
    const v = await adapter.query<{ v: string }>(`SELECT @@VERSION AS v`)
    const c = await adapter.query<{ n: number }>(`SELECT COUNT(*) AS n FROM [Person]`)
    return {
      ok: true,
      serverVersion: (v.rows[0]?.v ?? '').split('\n')[0]?.trim() || undefined,
      personRowCount: c.rows[0]?.n ?? 0
    }
  } catch (err) {
    if (isPausedServerlessError(err)) {
      return {
        ok: false,
        errorCode: 40613,
        errorMessage:
          `The database "${cfg.database}" appears to be paused (Azure SQL serverless). ` +
          `Connecting will wake it (30–60s). Press "Test Connection" again to retry.`
      }
    }
    return mapError(err)
  } finally {
    await adapter.close()
  }
}

/** Cross-database probe — informational. Logs whether the live server supports
 *  three-part-name queries to the backup DB. The engine still uses bridge mode
 *  regardless. */
export async function crossDbProbe(
  liveCfg: ConnectionConfig,
  backupDbName: string
): Promise<CrossDbProbeResult> {
  if (getAppMode() === 'test') return { ok: false, errorMessage: 'N/A in test mode' }
  if (!/^[A-Za-z0-9_-]+$/.test(backupDbName)) {
    return { ok: false, errorMessage: `Invalid backup DB name: ${backupDbName}` }
  }
  const adapter = new MssqlAdapter(liveCfg, { label: 'live:cross-db-probe' })
  try {
    await adapter.connect()
    await adapter.query(`SELECT TOP 1 1 AS x FROM [${backupDbName}].sys.objects`)
    return { ok: true }
  } catch (err) {
    if (isCrossDbNotSupportedError(err)) {
      return {
        ok: false,
        errorCode: 40515,
        errorMessage:
          'Cross-database queries are not supported on this server (Azure SQL). ' +
          'This is expected — the tool will use bridge mode.'
      }
    }
    return mapError(err)
  } finally {
    await adapter.close()
  }
}

/** Build the live adapter for an active operation. Caller is responsible for
 *  connect/close. */
export function makeLiveAdapter(cfg: ConnectionConfig): DatabaseAdapter {
  if (getAppMode() === 'test') {
    return new SqliteAdapter(testDbPaths().live, { label: 'sqlite:live', readonly: false })
  }
  return new MssqlAdapter(cfg, { label: 'mssql:live', readOnlyIntent: false })
}

/** Build the backup adapter for an active operation. The backup connection is
 *  always treated as read-only — this is enforced by the adapter and verified
 *  by the engine's bridge-mode pattern (writes only ever flow through the
 *  live adapter's transaction). */
export function makeBackupAdapter(cfg: ConnectionConfig): DatabaseAdapter {
  if (getAppMode() === 'test') {
    return new SqliteAdapter(testDbPaths().backup, { label: 'sqlite:backup', readonly: true })
  }
  return new MssqlAdapter(cfg, { label: 'mssql:backup', readOnlyIntent: true })
}

function mapError(err: unknown): ConnectionTestResult {
  const e = err as { number?: number; code?: string; message?: string }
  return {
    ok: false,
    errorCode: e.number ?? e.code,
    errorMessage: e.message ?? String(err)
  }
}

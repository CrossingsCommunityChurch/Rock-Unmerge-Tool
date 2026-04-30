// IPC routes — single registration point. Each handler is thin: it forwards
// to a domain module (connection-manager, profile-store, test-db-manager,
// app-mode) and converts thrown errors into a serializable error response.

import { app, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc-channels'
import type {
  AnalyzeRequest,
  ConnectionConfig,
  AppMode,
  PersonRecord,
  UnmergeProgress
} from '@shared/types'
import {
  crossDbProbe,
  makeBackupAdapter,
  makeLiveAdapter,
  testConnection
} from './connection-manager'
import { analyze, commit } from './unmerge-engine'
import { getSession as getActiveSession } from './session'
import { describeConnection, writeAuditLog } from './audit-log'
import {
  deleteProfile,
  listProfiles,
  loadProfile,
  saveProfile
} from './profile-store'
import {
  createTestDatabases,
  getTestDbStatus,
  resetTestDatabases,
  teardownTestDatabases
} from './test-mode/test-db-manager'
import { getAppMode, setAppMode } from './app-mode'
import { clearSession, getConfigForRole, setSession } from './session'

export function registerIpcHandlers(): void {
  // --- connection ---------------------------------------------------------
  ipcMain.handle(IPC.connection.test, (_e, cfg: ConnectionConfig) => testConnection(cfg))
  ipcMain.handle(
    IPC.connection.crossDbProbe,
    (_e, live: ConnectionConfig, backupDbName: string) => crossDbProbe(live, backupDbName)
  )

  // --- session ------------------------------------------------------------
  ipcMain.handle(
    IPC.session.set,
    (_e, live: ConnectionConfig, backup: ConnectionConfig) => {
      setSession(live, backup)
    }
  )
  ipcMain.handle(IPC.session.clear, () => {
    clearSession()
  })

  // --- profiles -----------------------------------------------------------
  ipcMain.handle(IPC.profile.list, () => listProfiles())
  ipcMain.handle(
    IPC.profile.save,
    (_e, name: string, live: ConnectionConfig, backup: ConnectionConfig) =>
      saveProfile(name, live, backup)
  )
  ipcMain.handle(IPC.profile.delete, (_e, id: string) => {
    deleteProfile(id)
  })
  ipcMain.handle(IPC.profile.load, (_e, id: string) => loadProfile(id))

  // --- test mode ----------------------------------------------------------
  ipcMain.handle(IPC.testMode.getStatus, () => getTestDbStatus())
  ipcMain.handle(IPC.testMode.create, () => createTestDatabases())
  ipcMain.handle(IPC.testMode.reset, () => resetTestDatabases())
  ipcMain.handle(IPC.testMode.teardown, () => {
    teardownTestDatabases()
  })

  // --- app ---------------------------------------------------------------
  ipcMain.handle(IPC.app.getMode, () => getAppMode())
  ipcMain.handle(IPC.app.setMode, (_e, mode: AppMode) => {
    setAppMode(mode)
  })
  ipcMain.handle(IPC.app.openAuditDir, async () => {
    const dir = join(app.getPath('userData'), 'audit-logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })

  // --- person -------------------------------------------------------------
  // Note: each handler must `await` the adapter call BEFORE returning. An
  // unawaited Promise return from a try-block lets the finally fire while the
  // query is still in flight; on mssql that closes the pool mid-flight and the
  // driver throws "Connection not yet open". better-sqlite3 (test mode) is
  // synchronous so the bug only manifests against real network connections.
  ipcMain.handle(
    IPC.person.searchByName,
    async (_e, role: 'live' | 'backup', firstName: string, lastName: string) => {
      const cfg = getConfigForRole(role)
      const adapter = role === 'live' ? makeLiveAdapter(cfg) : makeBackupAdapter(cfg)
      try {
        await adapter.connect()
        return await adapter.searchPersonByName(firstName, lastName)
      } finally {
        await adapter.close()
      }
    }
  )
  ipcMain.handle(
    IPC.person.getById,
    async (_e, role: 'live' | 'backup', id: number): Promise<PersonRecord | null> => {
      const cfg = getConfigForRole(role)
      const adapter = role === 'live' ? makeLiveAdapter(cfg) : makeBackupAdapter(cfg)
      try {
        await adapter.connect()
        return await adapter.getPersonById(id)
      } finally {
        await adapter.close()
      }
    }
  )

  // --- unmerge engine -----------------------------------------------------
  ipcMain.handle(IPC.unmerge.analyze, (e, req: AnalyzeRequest) =>
    runEngine(e.sender, req, /*commitMode*/ false)
  )
  ipcMain.handle(IPC.unmerge.commit, (e, req: AnalyzeRequest) =>
    runEngine(e.sender, req, /*commitMode*/ true)
  )
}

async function runEngine(
  sender: Electron.WebContents,
  req: AnalyzeRequest,
  commitMode: boolean
): Promise<unknown> {
  const session = getActiveSession()
  const mode = getAppMode()
  const live = makeLiveAdapter(session.live)
  const backup = makeBackupAdapter(session.backup)
  const onProgress = (event: UnmergeProgress): void => {
    if (!sender.isDestroyed()) sender.send(IPC.unmerge.progress, event)
  }
  const startedAt = new Date().toISOString()

  const auditContext = {
    mode,
    request: req,
    liveLabel: describeConnection(session.live, mode),
    backupLabel: describeConnection(session.backup, mode)
  }

  try {
    await Promise.all([live.connect(), backup.connect()])

    if (!commitMode) {
      return await analyze(live, backup, req, { onProgress })
    }

    try {
      const result = await commit(live, backup, req, { onProgress })
      const audit = writeAuditLog({
        context: auditContext,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        result,
        committed: true
      })
      return { ...result, auditLogPath: audit.path, auditLogFilename: audit.filename }
    } catch (err) {
      const finishedAt = new Date().toISOString()
      const errorMessage = (err as Error).message ?? String(err)
      try {
        writeAuditLog({
          context: auditContext,
          startedAt,
          finishedAt,
          committed: false,
          error: errorMessage
        })
      } catch {
        // Don't mask the original commit error if audit logging itself fails.
      }
      throw err
    }
  } finally {
    await Promise.allSettled([live.close(), backup.close()])
  }
}

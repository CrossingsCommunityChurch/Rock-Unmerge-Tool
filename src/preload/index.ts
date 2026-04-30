import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AnalyzeRequest,
  AnalyzeResult,
  CommitResult,
  ConnectionConfig,
  ConnectionTestResult,
  CrossDbProbeResult,
  AppMode,
  PersonRecord,
  SavedProfile,
  TestDbStatus,
  UnmergeProgress
} from '../shared/types'

// Typed bridge between renderer and main. Renderer code only ever touches
// `window.api` — no direct ipcRenderer access in components.
const api = {
  connection: {
    test: (cfg: ConnectionConfig): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke(IPC.connection.test, cfg),
    crossDbProbe: (
      live: ConnectionConfig,
      backupDbName: string
    ): Promise<CrossDbProbeResult> =>
      ipcRenderer.invoke(IPC.connection.crossDbProbe, live, backupDbName)
  },
  session: {
    set: (live: ConnectionConfig, backup: ConnectionConfig): Promise<void> =>
      ipcRenderer.invoke(IPC.session.set, live, backup),
    clear: (): Promise<void> => ipcRenderer.invoke(IPC.session.clear)
  },
  profile: {
    list: (): Promise<SavedProfile[]> => ipcRenderer.invoke(IPC.profile.list),
    save: (
      name: string,
      live: ConnectionConfig,
      backup: ConnectionConfig
    ): Promise<SavedProfile> => ipcRenderer.invoke(IPC.profile.save, name, live, backup),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.profile.delete, id),
    load: (
      id: string
    ): Promise<{ live: ConnectionConfig; backup: ConnectionConfig }> =>
      ipcRenderer.invoke(IPC.profile.load, id)
  },
  person: {
    searchByName: (
      role: 'live' | 'backup',
      firstName: string,
      lastName: string
    ): Promise<PersonRecord[]> =>
      ipcRenderer.invoke(IPC.person.searchByName, role, firstName, lastName),
    getById: (role: 'live' | 'backup', id: number): Promise<PersonRecord | null> =>
      ipcRenderer.invoke(IPC.person.getById, role, id)
  },
  unmerge: {
    analyze: (req: AnalyzeRequest): Promise<AnalyzeResult> =>
      ipcRenderer.invoke(IPC.unmerge.analyze, req),
    commit: (req: AnalyzeRequest): Promise<CommitResult> =>
      ipcRenderer.invoke(IPC.unmerge.commit, req),
    /** Subscribe to engine progress events. Returns an unsubscribe fn. */
    onProgress: (callback: (event: UnmergeProgress) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: UnmergeProgress): void =>
        callback(payload)
      ipcRenderer.on(IPC.unmerge.progress, handler)
      return () => {
        ipcRenderer.off(IPC.unmerge.progress, handler)
      }
    }
  },
  testMode: {
    getStatus: (): Promise<TestDbStatus> => ipcRenderer.invoke(IPC.testMode.getStatus),
    create: (): Promise<TestDbStatus> => ipcRenderer.invoke(IPC.testMode.create),
    reset: (): Promise<TestDbStatus> => ipcRenderer.invoke(IPC.testMode.reset),
    teardown: (): Promise<void> => ipcRenderer.invoke(IPC.testMode.teardown)
  },
  app: {
    getMode: (): Promise<AppMode> => ipcRenderer.invoke(IPC.app.getMode),
    setMode: (mode: AppMode): Promise<void> => ipcRenderer.invoke(IPC.app.setMode, mode),
    openAuditDir: (): Promise<void> => ipcRenderer.invoke(IPC.app.openAuditDir)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

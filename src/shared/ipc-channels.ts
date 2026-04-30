// Single source of truth for IPC channel names.
// Renderer talks to main exclusively through the preload bridge using these.

export const IPC = {
  connection: {
    test: 'connection:test',
    crossDbProbe: 'connection:cross-db-probe'
  },
  profile: {
    list: 'profile:list',
    save: 'profile:save',
    delete: 'profile:delete',
    load: 'profile:load'
  },
  session: {
    set: 'session:set',
    clear: 'session:clear'
  },
  person: {
    searchByName: 'person:search-by-name',
    getById: 'person:get-by-id'
  },
  unmerge: {
    analyze: 'unmerge:analyze',
    commit: 'unmerge:commit',
    progress: 'unmerge:progress'
  },
  testMode: {
    getStatus: 'test-mode:status',
    create: 'test-mode:create',
    reset: 'test-mode:reset',
    teardown: 'test-mode:teardown'
  },
  app: {
    getMode: 'app:get-mode',
    setMode: 'app:set-mode',
    openAuditDir: 'app:open-audit-dir'
  }
} as const

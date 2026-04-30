// Session — in-memory holder for the active live + backup connection configs
// once Screen 1 (Connect) verifies both connections.
//
// This avoids round-tripping the full config (including password) on every
// person/unmerge IPC call. State is intentionally process-local; if the
// renderer reloads or the main process restarts, the user re-runs Connect.

import type { ConnectionConfig } from '@shared/types'

interface Session {
  live: ConnectionConfig
  backup: ConnectionConfig
}

let session: Session | null = null

export function setSession(live: ConnectionConfig, backup: ConnectionConfig): void {
  session = { live: { ...live, role: 'live' }, backup: { ...backup, role: 'backup' } }
}

export function clearSession(): void {
  session = null
}

export function getSession(): Session {
  if (!session) {
    throw new Error(
      'No active session. Connect to both databases first (Screen 1) before performing this operation.'
    )
  }
  return session
}

export function getConfigForRole(role: 'live' | 'backup'): ConnectionConfig {
  const s = getSession()
  return role === 'live' ? s.live : s.backup
}

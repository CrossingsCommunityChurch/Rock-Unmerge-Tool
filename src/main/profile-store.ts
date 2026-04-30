// Profile store — persists named pairs of (live, backup) ConnectionConfigs.
//
// Passwords are encrypted with Electron's safeStorage API, which is bound to
// the OS keychain on the current user/machine. Profiles do not roam between
// machines as a result; the JSON file under userData would be unreadable
// elsewhere. This is intentional — see Q7 in the build conversation.
//
// To share connection presets between teammates, use exportProfileWithoutCredentials.

import { safeStorage } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { ConnectionConfig, SavedProfile } from '@shared/types'

interface StoredProfile {
  id: string
  name: string
  createdAt: string
  live: StoredConnection
  backup: StoredConnection
}

interface StoredConnection {
  config: Omit<ConnectionConfig, 'password'>
  /** base64-encoded ciphertext from safeStorage.encryptString. Empty if no password. */
  passwordCiphertext: string
}

interface Schema {
  profiles: StoredProfile[]
}

const store = new Store<Schema>({
  name: 'profiles',
  defaults: { profiles: [] }
})

export function listProfiles(): SavedProfile[] {
  return store.get('profiles').map(toSavedProfile)
}

export function loadProfile(id: string): { live: ConnectionConfig; backup: ConnectionConfig } {
  const p = store.get('profiles').find((x) => x.id === id)
  if (!p) throw new Error(`Profile not found: ${id}`)
  return {
    live: hydrateConnection(p.live),
    backup: hydrateConnection(p.backup)
  }
}

export function saveProfile(
  name: string,
  live: ConnectionConfig,
  backup: ConnectionConfig
): SavedProfile {
  const profile: StoredProfile = {
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    live: persistConnection(live),
    backup: persistConnection(backup)
  }
  const all = store.get('profiles')
  store.set('profiles', [...all, profile])
  return toSavedProfile(profile)
}

export function deleteProfile(id: string): void {
  const all = store.get('profiles').filter((x) => x.id !== id)
  store.set('profiles', all)
}

/** Produce a JSON string suitable for sharing with teammates — strips ciphertext. */
export function exportProfileWithoutCredentials(id: string): string {
  const p = store.get('profiles').find((x) => x.id === id)
  if (!p) throw new Error(`Profile not found: ${id}`)
  const sanitized = {
    name: p.name,
    exportedAt: new Date().toISOString(),
    live: { ...p.live.config },
    backup: { ...p.backup.config }
  }
  return JSON.stringify(sanitized, null, 2)
}

/** Parse a previously exported JSON string. Caller (UI) must collect passwords
 *  separately and call saveProfile with the completed configs. */
export function parseExportedProfile(json: string): {
  name: string
  live: Omit<ConnectionConfig, 'password'>
  backup: Omit<ConnectionConfig, 'password'>
} {
  const obj = JSON.parse(json) as {
    name?: string
    live?: Omit<ConnectionConfig, 'password'>
    backup?: Omit<ConnectionConfig, 'password'>
  }
  if (!obj.name || !obj.live || !obj.backup) {
    throw new Error('Exported profile is missing required fields (name, live, backup)')
  }
  return { name: obj.name, live: obj.live, backup: obj.backup }
}

// --- internals -------------------------------------------------------------

function persistConnection(c: ConnectionConfig): StoredConnection {
  const { password, ...rest } = c
  let passwordCiphertext = ''
  if (password && safeStorage.isEncryptionAvailable()) {
    passwordCiphertext = safeStorage.encryptString(password).toString('base64')
  } else if (password) {
    // Encryption unavailable (Linux without keyring, etc.) — refuse to persist
    // a plaintext password to disk.
    throw new Error(
      'safeStorage encryption is not available on this system; cannot persist password.'
    )
  }
  return { config: rest, passwordCiphertext }
}

function hydrateConnection(s: StoredConnection): ConnectionConfig {
  let password: string | undefined
  if (s.passwordCiphertext) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'safeStorage encryption is not available; cannot decrypt saved password.'
      )
    }
    password = safeStorage.decryptString(Buffer.from(s.passwordCiphertext, 'base64'))
  }
  return { ...s.config, password }
}

function toSavedProfile(p: StoredProfile): SavedProfile {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    live: { ...p.live.config, hasPassword: !!p.live.passwordCiphertext },
    backup: { ...p.backup.config, hasPassword: !!p.backup.passwordCiphertext }
  }
}

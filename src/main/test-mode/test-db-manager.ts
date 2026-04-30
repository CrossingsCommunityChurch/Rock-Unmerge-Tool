// Manages the lifecycle of the synthetic SQLite databases used in Test Mode.
//
// Files live under <userData>/test-data/. The user can create them, reset
// them (drop + reseed), and tear them down (delete) from the UI.

import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { applySchema } from './schema-builder'
import { seedBackup, seedLive } from './seed-data'
import type { TestDbStatus } from '@shared/types'

export const TEST_DB_NAMES = {
  live: 'rockunmerge_test_live.db',
  backup: 'rockunmerge_test_backup.db'
} as const

function testDataDir(): string {
  const dir = join(app.getPath('userData'), 'test-data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function testDbPaths(): { live: string; backup: string } {
  const dir = testDataDir()
  return {
    live: join(dir, TEST_DB_NAMES.live),
    backup: join(dir, TEST_DB_NAMES.backup)
  }
}

export function getTestDbStatus(): TestDbStatus {
  const paths = testDbPaths()
  const exists = existsSync(paths.live) && existsSync(paths.backup)
  return {
    livePath: exists ? paths.live : null,
    backupPath: exists ? paths.backup : null,
    exists
  }
}

/** Create both test databases from a fresh schema + seed.
 *  If files already exist, they are deleted first. */
export function createTestDatabases(): TestDbStatus {
  const paths = testDbPaths()
  for (const p of [paths.live, paths.backup]) if (existsSync(p)) unlinkSync(p)

  const backup = new Database(paths.backup)
  try {
    applySchema(backup)
    seedBackup(backup)
  } finally {
    backup.close()
  }

  const live = new Database(paths.live)
  try {
    applySchema(live)
    seedLive(live)
  } finally {
    live.close()
  }

  return getTestDbStatus()
}

/** Reset = create from scratch (drop + reseed). */
export function resetTestDatabases(): TestDbStatus {
  return createTestDatabases()
}

export function teardownTestDatabases(): void {
  const paths = testDbPaths()
  for (const p of [paths.live, paths.backup]) if (existsSync(p)) unlinkSync(p)
}

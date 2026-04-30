// DatabaseAdapter — abstraction shared by the production (mssql) and
// test-mode (sqlite) implementations.
//
// The unmerge engine takes two adapters (live + backup) and runs the same
// bridge-mode flow against either backend. Test mode and production must use
// the same engine code path; this interface is the seam.
//
// Design notes:
//
// 1. Low-level primitives (`query`, `execute`, transactions) carry the bulk
//    of the engine's SQL. Both backends understand standard SELECT/UPDATE
//    over the Rock subset we touch (Person, PersonAlias, GroupMember,
//    AttributeValue, UserLogin), so the engine writes that SQL once.
//
// 2. Backend-specific bits live in higher-level methods:
//      - schema discovery (sys.tables vs sqlite_master)
//      - chunked-IN parameterization (live)
//      - cross-DB references — none, by design (bridge mode)
//
// 3. Identifier-quoting: both MSSQL and SQLite accept `[name]` style, so the
//    helpers here use `[ ]` uniformly. All identifiers from sys.tables /
//    sqlite_master are validated via `validateIdentifier` before they ever
//    touch a SQL string.

import type { PersonRecord } from '@shared/types'

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowsAffected?: number
}

export interface AdapterTransaction {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult<T>>
  execute(sql: string, params?: Record<string, unknown>): Promise<number>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface DiscoveredColumn {
  tableName: string
  columnName: string
}

export interface DatabaseAdapter {
  readonly label: string
  readonly isReadOnly: boolean

  connect(): Promise<void>
  close(): Promise<void>

  query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult<T>>

  /** Live adapter only. Begin a write transaction. */
  beginTransaction(): Promise<AdapterTransaction>

  /** Discover tables/columns where the column name contains "PersonAliasId",
   *  excluding columns starting with CreatedBy/ModifiedBy and tables whose
   *  name contains "GroupMember". */
  discoverPersonAliasColumns(): Promise<DiscoveredColumn[]>

  /** Count rows in `table` where `column IN (...ids)`. Used in the analyze
   *  phase to populate the impact preview. Chunks the id list to stay under
   *  the per-statement parameter limit. */
  countWhereIdIn(table: string, column: string, ids: number[]): Promise<number>

  /** Select `Id` values from `table` where `column IN (...ids)`. Used against
   *  the BACKUP adapter to find the row IDs that originally referenced the
   *  previous person's aliases — those IDs are then sent to the live update
   *  to preserve the original script's safer JOIN semantics (only restore
   *  history that pre-dates the merge). */
  selectIdsWhereColIn(
    table: string,
    column: string,
    ids: number[]
  ): Promise<number[]>

  /** Within a live transaction, set `column = newValue` where `Id IN (...rowIds)`.
   *  Returns rows affected. */
  updateColumnByIds(
    tx: AdapterTransaction,
    table: string,
    column: string,
    rowIds: number[],
    newValue: number | string | null
  ): Promise<number>

  // ---- Person-level helpers used by the read phase and lookups ----

  getPersonById(personId: number): Promise<PersonRecord | null>
  searchPersonByName(firstName: string, lastName: string): Promise<PersonRecord[]>
  /** Live adapter only — used to auto-resolve the new alias id from the
   *  freshly-recreated person. */
  getPrimaryAliasId(personId: number): Promise<number | null>
}

const IDENT = /^[A-Za-z0-9_]+$/

export function validateIdentifier(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`Invalid identifier (rejected): ${name}`)
  }
  return name
}

/** Wrap a validated identifier in `[ ]` for safe interpolation. */
export function quoteIdent(name: string): string {
  return `[${validateIdentifier(name)}]`
}

/** Per the user's policy: chunk at 2000 to stay under the mssql per-statement
 *  parameter limit (2100). Log a warning at 10k+. */
export const ID_CHUNK_SIZE = 2000

export function chunkIds(ids: number[], size: number = ID_CHUNK_SIZE): number[][] {
  if (ids.length === 0) return []
  const out: number[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

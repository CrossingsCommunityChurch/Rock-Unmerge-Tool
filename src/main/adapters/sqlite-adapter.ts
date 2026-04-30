// SqliteAdapter — test-mode backend.
//
// Backed by better-sqlite3. SQLite's API is synchronous, so async methods
// here are thin wrappers; the upside is that "transactions" inside one
// adapter call are real and atomic with no driver round-trips.
//
// Identifier quoting uses `[ ]`, which SQLite supports for compatibility.
// Parameter binding uses `@name` named params, which SQLite also supports.

import Database, { type Database as Db } from 'better-sqlite3'
import type { PersonRecord } from '@shared/types'
import {
  chunkIds,
  ID_CHUNK_SIZE,
  quoteIdent,
  validateIdentifier,
  type AdapterTransaction,
  type DatabaseAdapter,
  type DiscoveredColumn,
  type QueryResult
} from './database-adapter'

export interface SqliteAdapterOptions {
  label?: string
  readonly?: boolean
  fileMustExist?: boolean
}

export class SqliteAdapter implements DatabaseAdapter {
  readonly label: string
  readonly isReadOnly: boolean
  private readonly dbPath: string
  private readonly fileMustExist: boolean
  private db: Db | null = null

  constructor(dbPath: string, opts: SqliteAdapterOptions = {}) {
    this.dbPath = dbPath
    this.label = opts.label ?? `sqlite:${dbPath}`
    this.isReadOnly = !!opts.readonly
    this.fileMustExist = opts.fileMustExist ?? true
  }

  async connect(): Promise<void> {
    if (this.db) return
    this.db = new Database(this.dbPath, {
      readonly: this.isReadOnly,
      fileMustExist: this.fileMustExist
    })
    this.db.pragma('foreign_keys = ON')
  }

  async close(): Promise<void> {
    if (!this.db) return
    this.db.close()
    this.db = null
  }

  private requireDb(): Db {
    if (!this.db) throw new Error(`${this.label}: adapter is not connected`)
    return this.db
  }

  /** better-sqlite3 rejects `undefined` — coerce to null. */
  private bind(params: Record<string, unknown> = {}): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) out[k] = v === undefined ? null : v
    return out
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<QueryResult<T>> {
    const db = this.requireDb()
    const stmt = db.prepare(sql)
    if (stmt.reader) {
      const rows = stmt.all(this.bind(params)) as T[]
      return { rows }
    }
    const info = stmt.run(this.bind(params))
    return { rows: [], rowsAffected: info.changes }
  }

  async beginTransaction(): Promise<AdapterTransaction> {
    if (this.isReadOnly) throw new Error(`${this.label}: cannot begin tx on read-only adapter`)
    const db = this.requireDb()
    db.exec('BEGIN IMMEDIATE')
    return new SqliteTransaction(db, this.bind.bind(this))
  }

  async discoverPersonAliasColumns(): Promise<DiscoveredColumn[]> {
    const db = this.requireDb()
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE '%GroupMember%'`
      )
      .all() as { name: string }[]

    const out: DiscoveredColumn[] = []
    for (const t of tables) {
      validateIdentifier(t.name) // sqlite_master content, but be paranoid
      const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[]
      for (const c of cols) {
        if (
          c.name.includes('PersonAliasId') &&
          !c.name.startsWith('CreatedBy') &&
          !c.name.startsWith('ModifiedBy')
        ) {
          out.push({ tableName: t.name, columnName: c.name })
        }
      }
    }
    out.sort((a, b) =>
      a.tableName === b.tableName
        ? a.columnName.localeCompare(b.columnName)
        : a.tableName.localeCompare(b.tableName)
    )
    return out
  }

  async countWhereIdIn(table: string, column: string, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0
    const t = quoteIdent(table)
    const c = quoteIdent(column)
    const db = this.requireDb()
    let total = 0
    for (const chunk of chunkIds(ids, ID_CHUNK_SIZE)) {
      const { sql, params } = renderInClause(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} IN`, chunk)
      const row = db.prepare(sql).get(this.bind(params)) as { n: number }
      total += row.n
    }
    return total
  }

  async selectIdsWhereColIn(
    table: string,
    column: string,
    ids: number[]
  ): Promise<number[]> {
    if (ids.length === 0) return []
    const t = quoteIdent(table)
    const c = quoteIdent(column)
    const db = this.requireDb()
    const out: number[] = []
    for (const chunk of chunkIds(ids, ID_CHUNK_SIZE)) {
      const { sql, params } = renderInClause(`SELECT [Id] AS Id FROM ${t} WHERE ${c} IN`, chunk)
      const rows = db.prepare(sql).all(this.bind(params)) as { Id: number }[]
      for (const r of rows) out.push(r.Id)
    }
    return out
  }

  async updateColumnByIds(
    tx: AdapterTransaction,
    table: string,
    column: string,
    rowIds: number[],
    newValue: number | string | null
  ): Promise<number> {
    if (rowIds.length === 0) return 0
    const t = quoteIdent(table)
    const c = quoteIdent(column)
    let affected = 0
    for (const chunk of chunkIds(rowIds, ID_CHUNK_SIZE)) {
      const { sql, params } = renderInClause(
        `UPDATE ${t} SET ${c} = @__newValue WHERE [Id] IN`,
        chunk
      )
      const n = await tx.execute(sql, { ...params, __newValue: newValue })
      affected += n
    }
    return affected
  }

  async getPersonById(personId: number): Promise<PersonRecord | null> {
    const r = await this.query<PersonRecord>(
      `SELECT Id, FirstName, LastName, NickName, Email, BirthDate, Gender,
              RecordStatusValueId, ConnectionStatusValueId, IsDeceased,
              CreatedDateTime, ModifiedDateTime, PrimaryAliasId
         FROM [Person] WHERE [Id] = @id`,
      { id: personId }
    )
    return r.rows[0] ?? null
  }

  async searchPersonByName(firstName: string, lastName: string): Promise<PersonRecord[]> {
    // LOWER on both sides keeps the comparison case-insensitive regardless
    // of the database's default collation. The first-name input is matched
    // against either FirstName or NickName so a search for "Jess" finds
    // someone whose FirstName is "Jessica" with NickName "Jess".
    const r = await this.query<PersonRecord>(
      `SELECT Id, FirstName, LastName, NickName, Email, BirthDate, Gender,
              RecordStatusValueId, ConnectionStatusValueId, IsDeceased,
              CreatedDateTime, ModifiedDateTime, PrimaryAliasId
         FROM [Person]
        WHERE (LOWER(FirstName) = LOWER(@first) OR LOWER(NickName) = LOWER(@first))
          AND LOWER(LastName) = LOWER(@last)
        ORDER BY Id`,
      { first: firstName, last: lastName }
    )
    return r.rows
  }

  async getPrimaryAliasId(personId: number): Promise<number | null> {
    const r = await this.query<{ PrimaryAliasId: number | null }>(
      `SELECT PrimaryAliasId FROM [Person] WHERE [Id] = @id`,
      { id: personId }
    )
    return r.rows[0]?.PrimaryAliasId ?? null
  }
}

class SqliteTransaction implements AdapterTransaction {
  private finished = false
  constructor(
    private readonly db: Db,
    private readonly bind: (p: Record<string, unknown>) => Record<string, unknown>
  ) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<QueryResult<T>> {
    this.assertOpen()
    const stmt = this.db.prepare(sql)
    if (stmt.reader) {
      const rows = stmt.all(this.bind(params)) as T[]
      return { rows }
    }
    const info = stmt.run(this.bind(params))
    return { rows: [], rowsAffected: info.changes }
  }

  async execute(sql: string, params: Record<string, unknown> = {}): Promise<number> {
    this.assertOpen()
    const info = this.db.prepare(sql).run(this.bind(params))
    return info.changes
  }

  async commit(): Promise<void> {
    this.assertOpen()
    this.db.exec('COMMIT')
    this.finished = true
  }

  async rollback(): Promise<void> {
    if (this.finished) return
    this.db.exec('ROLLBACK')
    this.finished = true
  }

  private assertOpen(): void {
    if (this.finished) throw new Error('Transaction already finished')
  }
}

/** Build a `<prefix> (@p0, @p1, ...)` clause and the matching params object. */
function renderInClause(
  prefix: string,
  ids: number[]
): { sql: string; params: Record<string, unknown> } {
  const placeholders = ids.map((_, i) => `@p${i}`).join(', ')
  const params: Record<string, unknown> = {}
  ids.forEach((id, i) => {
    params[`p${i}`] = id
  })
  return { sql: `${prefix} (${placeholders})`, params }
}

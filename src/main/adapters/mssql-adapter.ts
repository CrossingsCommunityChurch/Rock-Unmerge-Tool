// MssqlAdapter — production backend for SQL Server / Azure SQL.
//
// Connection-time concerns handled here (per spec):
//   - encryption defaults: encrypt=true, trustServerCertificate=false
//   - Azure SQL paused-serverless retry on error 40613
//   - read-only-intent flag passed for backup-role adapters (defense in depth)
//
// SQL Auth is the only authentication mode wired up today (Crossings only
// uses SQL Auth). Entra modes can be added later by extending buildPoolConfig.

import sql, {
  ConnectionPool,
  Transaction as MssqlTransaction,
  Request as MssqlRequest,
  type config as MssqlConfig
} from 'mssql'
import type { ConnectionConfig, PersonRecord } from '@shared/types'
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

const PAUSED_SERVERLESS_ERROR = 40613
const PAUSED_RETRY_TIMEOUT_MS = 60_000

export interface MssqlAdapterOptions {
  readOnlyIntent?: boolean
  label?: string
  /** Set false to suppress the auto-retry on error 40613. */
  retryOnPausedServerless?: boolean
}

export class MssqlAdapter implements DatabaseAdapter {
  readonly label: string
  readonly isReadOnly: boolean
  private readonly cfg: MssqlConfig
  private pool: ConnectionPool | null = null
  private readonly retryOnPaused: boolean

  constructor(connection: ConnectionConfig, opts: MssqlAdapterOptions = {}) {
    this.cfg = buildPoolConfig(connection, opts)
    this.label =
      opts.label ?? `mssql:${connection.server}/${connection.database} (${connection.role})`
    this.isReadOnly = !!opts.readOnlyIntent
    this.retryOnPaused = opts.retryOnPausedServerless ?? true
  }

  async connect(): Promise<void> {
    if (this.pool) return
    try {
      this.pool = await new ConnectionPool(this.cfg).connect()
    } catch (err) {
      if (this.retryOnPaused && isPausedServerlessError(err)) {
        // Wake-up retry: bump login timeout and try once more.
        const wakeCfg: MssqlConfig = {
          ...this.cfg,
          connectionTimeout: PAUSED_RETRY_TIMEOUT_MS,
          requestTimeout: PAUSED_RETRY_TIMEOUT_MS
        }
        this.pool = await new ConnectionPool(wakeCfg).connect()
        return
      }
      throw err
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return
    await this.pool.close()
    this.pool = null
  }

  private requirePool(): ConnectionPool {
    if (!this.pool) throw new Error(`${this.label}: adapter is not connected`)
    return this.pool
  }

  async query<T = Record<string, unknown>>(
    sqlText: string,
    params: Record<string, unknown> = {}
  ): Promise<QueryResult<T>> {
    const req = bindParams(this.requirePool().request(), params)
    const result = await req.query<T>(sqlText)
    return { rows: result.recordset ?? [], rowsAffected: sumAffected(result.rowsAffected) }
  }

  async beginTransaction(): Promise<AdapterTransaction> {
    if (this.isReadOnly) throw new Error(`${this.label}: cannot begin tx on read-only adapter`)
    const tx = new MssqlTransaction(this.requirePool())
    await tx.begin()
    return new MssqlAdapterTransaction(tx)
  }

  async discoverPersonAliasColumns(): Promise<DiscoveredColumn[]> {
    const r = await this.query<{ TableName: string; ColumnName: string }>(
      `SELECT t.name AS TableName, c.name AS ColumnName
         FROM sys.columns c
         JOIN sys.tables t ON c.object_id = t.object_id
        WHERE c.name LIKE '%PersonAliasId%'
          AND c.name NOT LIKE 'CreatedBy%'
          AND c.name NOT LIKE 'ModifiedBy%'
          AND t.name NOT LIKE '%GroupMember%'
        ORDER BY t.name, c.name`
    )
    return r.rows.map((row) => ({
      tableName: validateIdentifier(row.TableName),
      columnName: validateIdentifier(row.ColumnName)
    }))
  }

  async countWhereIdIn(table: string, column: string, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0
    const t = quoteIdent(table)
    const c = quoteIdent(column)
    let total = 0
    for (const chunk of chunkIds(ids, ID_CHUNK_SIZE)) {
      const { sql: text, params } = renderInClause(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} IN`, chunk)
      const r = await this.query<{ n: number }>(text, params)
      total += r.rows[0]?.n ?? 0
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
    const out: number[] = []
    for (const chunk of chunkIds(ids, ID_CHUNK_SIZE)) {
      const { sql: text, params } = renderInClause(`SELECT [Id] FROM ${t} WHERE ${c} IN`, chunk)
      const r = await this.query<{ Id: number }>(text, params)
      for (const row of r.rows) out.push(row.Id)
    }
    return out
  }

  async updateColumnByIds(
    txi: AdapterTransaction,
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
      const { sql: text, params } = renderInClause(
        `UPDATE ${t} SET ${c} = @__newValue WHERE [Id] IN`,
        chunk
      )
      affected += await txi.execute(text, { ...params, __newValue: newValue })
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
    return r.rows[0] ? normalizePersonRow(r.rows[0]) : null
  }

  async searchPersonByName(firstName: string, lastName: string): Promise<PersonRecord[]> {
    // LOWER on both sides keeps the comparison case-insensitive even on
    // case-sensitive SQL Server collations. The first-name input is matched
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
    return r.rows.map(normalizePersonRow)
  }

  async getPrimaryAliasId(personId: number): Promise<number | null> {
    const r = await this.query<{ PrimaryAliasId: number | null }>(
      `SELECT PrimaryAliasId FROM [Person] WHERE [Id] = @id`,
      { id: personId }
    )
    return r.rows[0]?.PrimaryAliasId ?? null
  }
}

class MssqlAdapterTransaction implements AdapterTransaction {
  private finished = false
  constructor(private readonly tx: MssqlTransaction) {}

  async query<T = Record<string, unknown>>(
    sqlText: string,
    params: Record<string, unknown> = {}
  ): Promise<QueryResult<T>> {
    this.assertOpen()
    const req = bindParams(new MssqlRequest(this.tx), params)
    const result = await req.query<T>(sqlText)
    return { rows: result.recordset ?? [], rowsAffected: sumAffected(result.rowsAffected) }
  }

  async execute(sqlText: string, params: Record<string, unknown> = {}): Promise<number> {
    this.assertOpen()
    const req = bindParams(new MssqlRequest(this.tx), params)
    const result = await req.query(sqlText)
    return sumAffected(result.rowsAffected)
  }

  async commit(): Promise<void> {
    this.assertOpen()
    await this.tx.commit()
    this.finished = true
  }

  async rollback(): Promise<void> {
    if (this.finished) return
    await this.tx.rollback()
    this.finished = true
  }

  private assertOpen(): void {
    if (this.finished) throw new Error('Transaction already finished')
  }
}

// ----- helpers -------------------------------------------------------------

function buildPoolConfig(c: ConnectionConfig, opts: MssqlAdapterOptions): MssqlConfig {
  if (c.authentication !== 'sql') {
    throw new Error(
      `Authentication type "${c.authentication}" is not yet implemented; only SQL Auth is supported`
    )
  }
  if (!c.username) throw new Error(`${c.role}: username is required for SQL Auth`)
  return {
    server: c.server,
    port: c.port,
    database: c.database,
    user: c.username,
    password: c.password ?? '',
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      enableArithAbort: true,
      readOnlyIntent: !!opts.readOnlyIntent
    },
    pool: { min: 0, max: 4, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout: 60_000
  }
}

function bindParams(req: MssqlRequest, params: Record<string, unknown>): MssqlRequest {
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'number' && Number.isInteger(value)) {
      req.input(name, sql.Int, value)
    } else if (typeof value === 'number') {
      req.input(name, sql.Float, value)
    } else if (typeof value === 'string') {
      req.input(name, sql.NVarChar, value)
    } else if (value === null || value === undefined) {
      req.input(name, sql.NVarChar, null)
    } else if (typeof value === 'boolean') {
      req.input(name, sql.Bit, value)
    } else if (value instanceof Date) {
      req.input(name, sql.DateTime2, value)
    } else {
      req.input(name, value)
    }
  }
  return req
}

function sumAffected(rowsAffected: number[] | number | undefined): number {
  if (typeof rowsAffected === 'number') return rowsAffected
  if (Array.isArray(rowsAffected)) return rowsAffected.reduce((a, b) => a + b, 0)
  return 0
}

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

/** mssql returns native Date objects for date/datetime/datetime2 columns.
 *  PersonRecord types these as `string | null` and the renderer renders the
 *  values directly (where React throws on non-primitive children). Coerce
 *  Date columns to ISO strings at the adapter boundary so the contract holds. */
function normalizePersonRow(row: PersonRecord): PersonRecord {
  return {
    ...row,
    BirthDate: toIsoString(row.BirthDate),
    CreatedDateTime: toIsoString(row.CreatedDateTime),
    ModifiedDateTime: toIsoString(row.ModifiedDateTime)
  }
}

function toIsoString(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

export function isPausedServerlessError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const anyErr = err as { number?: number; code?: string; message?: string }
  if (anyErr.number === PAUSED_SERVERLESS_ERROR) return true
  return /\b40613\b/.test(anyErr.message ?? '')
}

export function isCrossDbNotSupportedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const anyErr = err as { number?: number; message?: string }
  if (anyErr.number === 40515) return true
  return /\b40515\b/.test(anyErr.message ?? '')
}

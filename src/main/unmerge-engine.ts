// Unmerge engine — bridge-mode implementation of the original Rock RMS
// "Unmerge_Person_with_Alias_Detection.sql" script. Operates against two
// adapters (live + backup) and runs the same logic in production (mssql) and
// test mode (sqlite).
//
// Phase outline (matches reference/Unmerge_Person_with_Alias_Detection.sql):
//
//   1. Read phase (BACKUP, read-only)
//      a. PersonAlias.Id where PersonId = @previousPersonId  → previousAliasIds
//      b. GroupMember.Id where PersonId = @previousPersonId AND Group.GroupTypeId <> 10
//         (filter at backup read time per build-spec Q2; family memberships are excluded)
//      c. AttributeValue.Id where Attribute.EntityTypeId = 15 AND EntityId = @previousPersonId
//      d. UserLogin.Id where PersonId = @previousPersonId
//
//   2. Defensive verification (LIVE)
//      Look up the backup alias ids in live's PersonAlias to find the distinct
//      PersonId(s) they currently belong to. Confirms that the wrong-recipient
//      the user selected is in fact the merge target. (Not in the original
//      script — added as a sanity guard.)
//
//   3. Schema discovery (LIVE)
//      Tables where column name contains 'PersonAliasId', excluding CreatedBy*,
//      ModifiedBy*, and any %GroupMember% table. For each, count rows whose
//      column value is in previousAliasIds — surfaces the "Tables affected"
//      preview.
//
//   4. Per-table backup-id fetch (BACKUP)
//      For every affected (table, column) pair, fetch the row Id values from
//      the BACKUP version of that table where column ∈ previousAliasIds.
//      These are rows that existed pre-merge — only these are repointed,
//      preserving the original script's safer JOIN-by-Id semantics. Post-merge
//      rows in live are intentionally left attributed to the wrong-recipient.
//
//   5. Write phase (LIVE, single transaction)
//      a. UPDATE [GroupMember]   SET PersonId = @new WHERE Id IN (groupMemberIds)
//      b. UPDATE [AttributeValue] SET EntityId = @new WHERE Id IN (attributeValueIds)
//                                       AND AttributeId IN (Person attributes)  ← defense-in-depth
//      c. UPDATE [UserLogin]      SET PersonId = @new WHERE Id IN (userLoginIds)
//      d. For each affected (table, column): UPDATE [<table>] SET [<column>] = @newAliasId
//                                              WHERE Id IN (backup row ids)
//      Then ROLLBACK (analyze) or COMMIT (commit).
//
// All identifiers from sys.tables / sqlite_master flow through validateIdentifier
// in the adapters before they ever land in a SQL string.

import type {
  AffectedTable,
  AnalyzeRequest,
  AnalyzeResult,
  CommitResult,
  ProfileFieldRestore,
  ProfileRestorePlan,
  UnmergeProgress
} from '@shared/types'
import {
  chunkIds,
  ID_CHUNK_SIZE,
  validateIdentifier,
  type AdapterTransaction,
  type DatabaseAdapter
} from './adapters/database-adapter'

const ROCK_FAMILY_GROUP_TYPE_ID = 10
const ROCK_PERSON_ENTITY_TYPE_ID = 15
/** Rock's default DefinedValueId for the "Mobile" phone type. Standard install
 *  value; some sites may have customized it. If your install differs, this is
 *  the constant to change. */
const ROCK_MOBILE_PHONE_TYPE_ID = 12

interface BackupProfileRow {
  Email: string | null
  Gender: number | null
  BirthDate: string | null
  BirthMonth: number | null
  BirthDay: number | null
  BirthYear: number | null
  GraduationYear: number | null
  MaritalStatusValueId: number | null
  PhotoId: number | null
}

const PROFILE_COLUMNS: ReadonlyArray<keyof BackupProfileRow> = [
  'Email',
  'Gender',
  'BirthDate',
  'BirthMonth',
  'BirthDay',
  'BirthYear',
  'GraduationYear',
  'MaritalStatusValueId',
  'PhotoId'
]

export type ProgressCallback = (event: UnmergeProgress) => void

export interface EngineOptions {
  onProgress?: ProgressCallback
}

export async function analyze(
  live: DatabaseAdapter,
  backup: DatabaseAdapter,
  req: AnalyzeRequest,
  opts: EngineOptions = {}
): Promise<AnalyzeResult> {
  return runUnmerge(live, backup, req, /*commitMode*/ false, opts)
}

export async function commit(
  live: DatabaseAdapter,
  backup: DatabaseAdapter,
  req: AnalyzeRequest,
  opts: EngineOptions = {}
): Promise<CommitResult> {
  const startedAt = new Date().toISOString()
  try {
    const result = await runUnmerge(live, backup, req, /*commitMode*/ true, opts)
    return { ...result, committed: true, startedAt, finishedAt: new Date().toISOString() }
  } catch (err) {
    const finishedAt = new Date().toISOString()
    const message = (err as Error).message ?? String(err)
    throw Object.assign(new Error(message), { startedAt, finishedAt, cause: err })
  }
}

async function runUnmerge(
  live: DatabaseAdapter,
  backup: DatabaseAdapter,
  req: AnalyzeRequest,
  commitMode: boolean,
  opts: EngineOptions
): Promise<AnalyzeResult> {
  const sqlLog: string[] = []
  const log = (sql: string, params?: Record<string, unknown>): void => {
    const trimmed = sql.trim()
    if (params && Object.keys(params).length) {
      sqlLog.push(`-- params: ${JSON.stringify(params)}\n${trimmed}`)
    } else {
      sqlLog.push(trimmed)
    }
  }
  const progress = (event: UnmergeProgress): void => {
    opts.onProgress?.(event)
  }

  // === 1. Read phase (backup) ===========================================
  progress({ step: 'read-backup', detail: 'Reading the original person from backup' })

  const backupPerson = await backup.getPersonById(req.previousPersonId)
  const livePerson = await live.getPersonById(req.currentPersonId)
  const wrongRecipientPerson = await live.getPersonById(req.wrongRecipientPersonId)

  const aliasRows = await backup.query<{ Id: number }>(
    `SELECT Id FROM [PersonAlias] WHERE PersonId = @id`,
    { id: req.previousPersonId }
  )
  const previousAliasIds = aliasRows.rows.map((r) => r.Id)
  log(`SELECT Id FROM [PersonAlias] WHERE PersonId = @id  -- backup`, {
    id: req.previousPersonId
  })

  const groupMemberRows = await backup.query<{ Id: number }>(
    `SELECT GM.Id
       FROM [GroupMember] GM
       JOIN [Group] G ON GM.GroupId = G.Id
      WHERE GM.PersonId = @id AND G.GroupTypeId <> @familyGroupType`,
    { id: req.previousPersonId, familyGroupType: ROCK_FAMILY_GROUP_TYPE_ID }
  )
  const groupMemberIds = groupMemberRows.rows.map((r) => r.Id)
  log(
    `SELECT GM.Id FROM [GroupMember] GM JOIN [Group] G ON GM.GroupId = G.Id ` +
      `WHERE GM.PersonId = @id AND G.GroupTypeId <> ${ROCK_FAMILY_GROUP_TYPE_ID}  -- backup`,
    { id: req.previousPersonId }
  )

  const avRows = await backup.query<{ Id: number }>(
    `SELECT AV.Id
       FROM [AttributeValue] AV
       JOIN [Attribute] A ON AV.AttributeId = A.Id
      WHERE A.EntityTypeId = @personEntityType
        AND AV.EntityId = @id`,
    { id: req.previousPersonId, personEntityType: ROCK_PERSON_ENTITY_TYPE_ID }
  )
  const attributeValueIds = avRows.rows.map((r) => r.Id)
  log(
    `SELECT AV.Id FROM [AttributeValue] AV JOIN [Attribute] A ON AV.AttributeId = A.Id ` +
      `WHERE A.EntityTypeId = ${ROCK_PERSON_ENTITY_TYPE_ID} AND AV.EntityId = @id  -- backup`,
    { id: req.previousPersonId }
  )

  const ulRows = await backup.query<{ Id: number }>(
    `SELECT Id FROM [UserLogin] WHERE PersonId = @id`,
    { id: req.previousPersonId }
  )
  const userLoginIds = ulRows.rows.map((r) => r.Id)
  log(`SELECT Id FROM [UserLogin] WHERE PersonId = @id  -- backup`, {
    id: req.previousPersonId
  })

  // History entries that are *about* the previous person (EntityTypeId 15 =
  // Person). The original SQL script doesn't repoint these -- it's a known
  // gap. We close it here using the same JOIN-by-Id pattern as
  // AttributeValue, with the same EntityTypeId 15 defense-in-depth check
  // applied on the live update side.
  const historyRows = await backup.query<{ Id: number }>(
    `SELECT Id FROM [History]
      WHERE EntityTypeId = @personEntityType AND EntityId = @id`,
    { id: req.previousPersonId, personEntityType: ROCK_PERSON_ENTITY_TYPE_ID }
  )
  const historyAboutPersonIds = historyRows.rows.map((r) => r.Id)
  log(
    `SELECT Id FROM [History] WHERE EntityTypeId = ${ROCK_PERSON_ENTITY_TYPE_ID} ` +
      `AND EntityId = @id  -- backup (history-about-person)`,
    { id: req.previousPersonId }
  )

  // Profile-restore read (backup): biographical fields the user asked us to
  // copy onto the new blank record. Mobile-type PhoneNumber rows get
  // repointed-by-Id (same JOIN-by-Id pattern as GroupMember), since Rock's
  // merge moved them onto the wrong-recipient.
  const profileRows = await backup.query<BackupProfileRow>(
    `SELECT Email, Gender, BirthDate, BirthMonth, BirthDay, BirthYear,
            GraduationYear, MaritalStatusValueId, PhotoId
       FROM [Person] WHERE Id = @id`,
    { id: req.previousPersonId }
  )
  const backupProfile = profileRows.rows[0] ?? null
  log(
    `SELECT Email, Gender, BirthDate, BirthMonth, BirthDay, BirthYear, ` +
      `GraduationYear, MaritalStatusValueId, PhotoId FROM [Person] WHERE Id = @id  -- backup`,
    { id: req.previousPersonId }
  )

  const liveProfileRows = await live.query<BackupProfileRow>(
    `SELECT Email, Gender, BirthDate, BirthMonth, BirthDay, BirthYear,
            GraduationYear, MaritalStatusValueId, PhotoId
       FROM [Person] WHERE Id = @id`,
    { id: req.currentPersonId }
  )
  const liveProfile = liveProfileRows.rows[0] ?? null

  const personUpdates: ProfileFieldRestore[] = []
  if (backupProfile) {
    for (const col of PROFILE_COLUMNS) {
      const backupValue = backupProfile[col] ?? null
      if (!isProfileValuePresent(col, backupValue)) continue
      const liveValue = liveProfile?.[col] ?? null
      const willOverwrite = isProfileValuePresent(col, liveValue)
      personUpdates.push({
        column: validateIdentifier(col),
        backupValue,
        liveValue,
        willOverwrite
      })
    }
  }

  // PhotoId guard: Person.PhotoId is an FK into BinaryFile. If the binary
  // file row from the backup no longer exists in live (rare -- Rock doesn't
  // typically hard-delete during merge -- but possible if cleanup ran), the
  // commit would fail with an FK violation and roll back the entire
  // transaction. Drop PhotoId from the plan and surface a note instead.
  const photoIndex = personUpdates.findIndex((u) => u.column === 'PhotoId')
  if (photoIndex >= 0) {
    const photoId = personUpdates[photoIndex].backupValue as number
    const exists = await live.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM [BinaryFile] WHERE [Id] = @id`,
      { id: photoId }
    )
    log(
      `SELECT COUNT(*) FROM [BinaryFile] WHERE [Id] = @id  -- live, PhotoId guard`,
      { id: photoId }
    )
    if ((exists.rows[0]?.n ?? 0) === 0) {
      personUpdates.splice(photoIndex, 1)
      log(
        `-- WARNING: backup PhotoId=${photoId} no longer exists in live's BinaryFile. ` +
          `Skipping profile-photo restore for this column.`
      )
    }
  }

  const mobilePhoneRows = await backup.query<{ Id: number }>(
    `SELECT Id FROM [PhoneNumber] WHERE PersonId = @id AND NumberTypeValueId = @mobile`,
    { id: req.previousPersonId, mobile: ROCK_MOBILE_PHONE_TYPE_ID }
  )
  const mobilePhoneIds = mobilePhoneRows.rows.map((r) => r.Id)
  log(
    `SELECT Id FROM [PhoneNumber] WHERE PersonId = @id ` +
      `AND NumberTypeValueId = ${ROCK_MOBILE_PHONE_TYPE_ID}  -- backup`,
    { id: req.previousPersonId }
  )

  const profileRestore: ProfileRestorePlan = { personUpdates, mobilePhoneIds }

  // === 2. Defensive verification (live) =================================
  progress({
    step: 'verify-recipients',
    detail: "Checking which live record currently holds the original person's aliases"
  })

  const recipientSet = new Set<number>()
  for (const chunk of chunkIds(previousAliasIds, ID_CHUNK_SIZE)) {
    const placeholders = chunk.map((_, i) => `@p${i}`).join(', ')
    const params: Record<string, unknown> = {}
    chunk.forEach((id, i) => {
      params[`p${i}`] = id
    })
    const r = await live.query<{ PersonId: number }>(
      `SELECT DISTINCT PersonId FROM [PersonAlias] WHERE [Id] IN (${placeholders})  -- live`,
      params
    )
    for (const row of r.rows) recipientSet.add(row.PersonId)
  }
  log(`SELECT DISTINCT PersonId FROM [PersonAlias] WHERE [Id] IN (...)  -- live`)

  const aliasCurrentRecipientIds = [...recipientSet].sort((a, b) => a - b)
  const matchesWrongRecipient =
    recipientSet.size === 1 && recipientSet.has(req.wrongRecipientPersonId)
  let verificationMessage: string | null = null
  if (recipientSet.size === 0) {
    verificationMessage =
      "No PersonAlias rows in live currently reference the original person's alias ids -- there's nothing to unmerge."
  } else if (recipientSet.size > 1) {
    verificationMessage =
      `The original person's aliases currently point at ${recipientSet.size} different live PersonIds ` +
      `(${aliasCurrentRecipientIds.join(', ')}). This may indicate a multi-merge chain. ` +
      `Review the data carefully before committing.`
  } else if (!recipientSet.has(req.wrongRecipientPersonId)) {
    const actual = aliasCurrentRecipientIds[0]
    verificationMessage =
      `The original person's aliases currently point at PersonId ${actual} in live, ` +
      `not the wrong-recipient (${req.wrongRecipientPersonId}) you selected. ` +
      `Confirm the wrong-recipient is correct.`
  }

  // === 3. Schema discovery + impact count (live) ========================
  progress({ step: 'discover-schema', detail: 'Discovering PersonAliasId columns in live' })
  const columns = await live.discoverPersonAliasColumns()
  log(
    `-- schema discovery: ${columns.length} columns matching %PersonAliasId% ` +
      `(excluding CreatedBy*/ModifiedBy* and %GroupMember% tables)`
  )

  progress({
    step: 'count-impacts',
    detail: `Counting alias references across ${columns.length} columns`
  })
  const liveCounts = new Map<string, number>()
  for (const { tableName, columnName } of columns) {
    const recordCount = await live.countWhereIdIn(tableName, columnName, previousAliasIds)
    liveCounts.set(`${tableName}.${columnName}`, recordCount)
    log(
      `SELECT COUNT(*) FROM [${tableName}] WHERE [${columnName}] IN (...previousAliasIds)  ` +
        `-- live -> ${recordCount}`
    )
  }

  // === 4. Per-table backup row-id fetch (backup) ========================
  // Per Q1: preserve the original script's JOIN-by-Id semantics. Only rows
  // that existed in the backup at the time of the snapshot get repointed.
  progress({
    step: 'fetch-backup-row-ids',
    detail: 'Fetching pre-merge row ids from backup for each affected table'
  })

  const affectedTables: AffectedTable[] = []
  const backupRowIdsPerKey = new Map<string, number[]>()
  for (const { tableName, columnName } of columns) {
    const key = `${tableName}.${columnName}`
    const liveCount = liveCounts.get(key) ?? 0
    if (liveCount === 0) continue

    const backupIds = await backup.selectIdsWhereColIn(tableName, columnName, previousAliasIds)
    backupRowIdsPerKey.set(key, backupIds)
    affectedTables.push({
      tableName,
      columnName,
      recordCount: liveCount,
      willUpdateCount: backupIds.length
    })
    log(
      `SELECT Id FROM [${tableName}] WHERE [${columnName}] IN (...previousAliasIds)  ` +
        `-- backup -> ${backupIds.length} pre-merge rows`
    )
  }

  // === 5. Write phase (live, single transaction) ========================
  log(`-- BEGIN TRAN  -- live  (mode=${commitMode ? 'COMMIT' : 'DRY RUN'})`)
  const tx = await live.beginTransaction()

  let totalsGroupMember = 0
  let totalsAttributeValue = 0
  let totalsUserLogin = 0
  let totalsAlias = 0
  let totalsProfileColumns = 0
  let totalsMobilePhones = 0
  let totalsHistoryEntity = 0

  try {
    // 5a. GroupMember
    progress({
      step: 'write-group-member',
      detail: `Updating ${groupMemberIds.length} GroupMember row(s)`
    })
    if (groupMemberIds.length > 0) {
      for (const chunk of chunkIds(groupMemberIds, ID_CHUNK_SIZE)) {
        const { sql, params } = buildIdInUpdate(
          `UPDATE [GroupMember] SET PersonId = @__newPid WHERE [Id] IN`,
          chunk,
          { __newPid: req.currentPersonId }
        )
        const n = await tx.execute(sql, params)
        totalsGroupMember += n
        log(sql, params)
      }
    }

    // 5b. AttributeValue (defense-in-depth: still a person attribute on live)
    progress({
      step: 'write-attribute-value',
      detail: `Updating ${attributeValueIds.length} AttributeValue row(s)`
    })
    if (attributeValueIds.length > 0) {
      for (const chunk of chunkIds(attributeValueIds, ID_CHUNK_SIZE)) {
        const { sql: idClause, params } = buildIdInClause(chunk)
        const fullParams = {
          ...params,
          __newPid: req.currentPersonId,
          __personEntityType: ROCK_PERSON_ENTITY_TYPE_ID
        }
        const sql =
          `UPDATE [AttributeValue] SET EntityId = @__newPid ` +
          `WHERE [Id] IN ${idClause} ` +
          `AND AttributeId IN (SELECT Id FROM [Attribute] WHERE EntityTypeId = @__personEntityType)`
        const n = await tx.execute(sql, fullParams)
        totalsAttributeValue += n
        log(sql, fullParams)
      }
    }

    // 5c. UserLogin
    progress({
      step: 'write-user-login',
      detail: `Updating ${userLoginIds.length} UserLogin row(s)`
    })
    if (userLoginIds.length > 0) {
      for (const chunk of chunkIds(userLoginIds, ID_CHUNK_SIZE)) {
        const { sql, params } = buildIdInUpdate(
          `UPDATE [UserLogin] SET PersonId = @__newPid WHERE [Id] IN`,
          chunk,
          { __newPid: req.currentPersonId }
        )
        const n = await tx.execute(sql, params)
        totalsUserLogin += n
        log(sql, params)
      }
    }

    // 5c'. History.EntityId for person-type entries.
    // Parallels AttributeValue: JOIN-by-Id from backup, EntityTypeId 15
    // defense on the live side (so a History row whose EntityTypeId got
    // changed since the backup is left alone). Not in the original script;
    // closes a known gap.
    progress({
      step: 'write-history-entity',
      detail: `Updating ${historyAboutPersonIds.length} History row(s) about the person`
    })
    if (historyAboutPersonIds.length > 0) {
      for (const chunk of chunkIds(historyAboutPersonIds, ID_CHUNK_SIZE)) {
        const { sql: idClause, params } = buildIdInClause(chunk)
        const fullParams = {
          ...params,
          __newPid: req.currentPersonId,
          __personEntityType: ROCK_PERSON_ENTITY_TYPE_ID
        }
        const sql =
          `UPDATE [History] SET EntityId = @__newPid ` +
          `WHERE [Id] IN ${idClause} AND EntityTypeId = @__personEntityType`
        const n = await tx.execute(sql, fullParams)
        totalsHistoryEntity += n
        log(sql, fullParams)
      }
    }

    // 5d. Alias references (one update per affected table+column)
    progress({
      step: 'write-alias-references',
      detail: `Repointing alias references across ${affectedTables.length} table(s)`
    })
    for (const t of affectedTables) {
      const ids = backupRowIdsPerKey.get(`${t.tableName}.${t.columnName}`) ?? []
      const n = await live.updateColumnByIds(
        tx,
        t.tableName,
        t.columnName,
        ids,
        req.currentPersonAliasId
      )
      totalsAlias += n
      log(
        `UPDATE [${t.tableName}] SET [${t.columnName}] = @newAliasId ` +
          `WHERE [Id] IN (...${ids.length} backup ids)  -- ${n} row(s) updated`,
        { newAliasId: req.currentPersonAliasId }
      )
    }

    // 5e. Profile basics (Person columns + mobile phones)
    // Not in the original SQL script -- added per the user's "restore profile
    // basics on the new blank record" requirement. Person columns are written
    // when backup has a value; mobile-type PhoneNumber rows are repointed by
    // Id (same JOIN-by-Id pattern as GroupMember/UserLogin/AttributeValue).
    progress({
      step: 'write-profile-restore',
      detail:
        `Restoring ${personUpdates.length} profile column(s) and ` +
        `${mobilePhoneIds.length} mobile phone row(s)`
    })
    if (personUpdates.length > 0) {
      const setClauses: string[] = []
      const params: Record<string, unknown> = { __id: req.currentPersonId }
      for (let i = 0; i < personUpdates.length; i++) {
        const u = personUpdates[i]
        // Column name was validated in the read phase via validateIdentifier.
        setClauses.push(`[${u.column}] = @v${i}`)
        params[`v${i}`] = u.backupValue
      }
      const sql = `UPDATE [Person] SET ${setClauses.join(', ')} WHERE [Id] = @__id`
      const n = await tx.execute(sql, params)
      totalsProfileColumns += n
      log(sql, params)
    }
    if (mobilePhoneIds.length > 0) {
      for (const chunk of chunkIds(mobilePhoneIds, ID_CHUNK_SIZE)) {
        const { sql, params } = buildIdInUpdate(
          `UPDATE [PhoneNumber] SET PersonId = @__newPid WHERE [Id] IN`,
          chunk,
          { __newPid: req.currentPersonId }
        )
        const n = await tx.execute(sql, params)
        totalsMobilePhones += n
        log(sql, params)
      }
    }

    // Finalize
    if (commitMode) {
      progress({ step: 'finalize-commit', detail: 'Committing transaction' })
      await tx.commit()
      log('-- COMMIT TRAN  -- live')
    } else {
      progress({ step: 'finalize-rollback', detail: 'Rolling back (dry run)' })
      await tx.rollback()
      log('-- ROLLBACK TRAN  -- live (dry run; no changes persisted)')
    }
  } catch (err) {
    // Rollback on failure regardless of mode
    try {
      await tx.rollback()
      log('-- ROLLBACK TRAN  -- error path')
    } catch {
      // already rolled back
    }
    throw err
  }

  if (previousAliasIds.length > 10_000) {
    log(
      `-- WARNING: previousAliasIds.length = ${previousAliasIds.length}. ` +
        `Chunked-IN exceeds 10k threshold; consider TVPs (build-spec Q4).`
    )
  }

  return {
    backupPerson,
    livePerson,
    wrongRecipientPerson,
    previousAliasIds,
    groupMemberIds,
    attributeValueIds,
    userLoginIds,
    historyAboutPersonIds,
    affectedTables,
    profileRestore,
    totals: {
      groupMemberUpdates: totalsGroupMember,
      attributeValueUpdates: totalsAttributeValue,
      userLoginUpdates: totalsUserLogin,
      aliasReferenceUpdates: totalsAlias,
      profileColumnUpdates: totalsProfileColumns,
      mobilePhoneUpdates: totalsMobilePhones,
      historyEntityUpdates: totalsHistoryEntity
    },
    verification: {
      aliasCurrentRecipientIds,
      matchesWrongRecipient,
      message: verificationMessage
    },
    sqlLog
  }
}

// ----- helpers -----------------------------------------------------------

/** Treat NULL, empty string, and 0-Unknown for Gender as "no value". For
 *  every other column we trust the raw presence check. */
function isProfileValuePresent(column: string, v: string | number | null): boolean {
  if (v == null) return false
  if (typeof v === 'string' && v.trim() === '') return false
  if (column === 'Gender' && v === 0) return false
  return true
}

function buildIdInClause(ids: number[]): { sql: string; params: Record<string, unknown> } {
  const placeholders = ids.map((_, i) => `@p${i}`).join(', ')
  const params: Record<string, unknown> = {}
  ids.forEach((id, i) => {
    params[`p${i}`] = id
  })
  return { sql: `(${placeholders})`, params }
}

function buildIdInUpdate(
  prefix: string,
  ids: number[],
  extra: Record<string, unknown> = {}
): { sql: string; params: Record<string, unknown> } {
  const { sql: clause, params } = buildIdInClause(ids)
  return { sql: `${prefix} ${clause}`, params: { ...params, ...extra } }
}

// Small re-export so the IPC handler doesn't need to import the adapter type.
export type { AdapterTransaction }

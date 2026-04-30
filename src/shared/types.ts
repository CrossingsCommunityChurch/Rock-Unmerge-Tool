// Shared types between main and renderer processes.
// Anything passed across the IPC bridge MUST be defined here so both sides
// stay in sync.

export type AuthenticationType =
  | 'sql'
  | 'azure-ad-password'
  | 'azure-ad-integrated'
  | 'azure-ad-interactive'

export type ConnectionRole = 'live' | 'backup'

export interface ConnectionConfig {
  role: ConnectionRole
  server: string
  port: number
  database: string
  authentication: AuthenticationType
  username?: string
  password?: string
  encrypt: boolean
  trustServerCertificate: boolean
}

export interface ConnectionTestResult {
  ok: boolean
  serverVersion?: string
  personRowCount?: number
  errorCode?: string | number
  errorMessage?: string
}

export interface CrossDbProbeResult {
  ok: boolean
  errorCode?: string | number
  errorMessage?: string
  // Always informational — the engine uses bridge mode regardless.
}

export interface SavedProfile {
  id: string
  name: string
  createdAt: string
  live: Omit<ConnectionConfig, 'password'> & { hasPassword: boolean }
  backup: Omit<ConnectionConfig, 'password'> & { hasPassword: boolean }
}

export interface PersonRecord {
  Id: number
  FirstName: string | null
  LastName: string | null
  NickName: string | null
  Email: string | null
  BirthDate: string | null
  Gender: number | null
  RecordStatusValueId: number | null
  ConnectionStatusValueId: number | null
  IsDeceased: number | boolean | null
  CreatedDateTime: string | null
  ModifiedDateTime: string | null
  PrimaryAliasId: number | null
}

/** Rock's RecordStatus DefinedType: standard ids in a default install.
 *  Local installations may have customized these. */
export const RECORD_STATUS = {
  ACTIVE: 3,
  INACTIVE: 4,
  PENDING: 5
} as const

export interface AffectedTable {
  tableName: string
  columnName: string
  /** Live rows whose <column> currently references one of the previous alias ids.
   *  Includes any post-merge rows created against the wrong-recipient. */
  recordCount: number
  /** Subset of the above: rows whose Id also appears in the BACKUP table with
   *  a matching alias reference. Per the original script's JOIN-by-Id pattern,
   *  only these rows are repointed — post-merge rows are intentionally left
   *  attributed to the wrong-recipient because they never belonged to the
   *  unmerge target. Will equal recordCount when no post-merge activity exists. */
  willUpdateCount: number
}

export interface AnalyzeRequest {
  /** PersonId of the original (pre-merge) record in the backup database. */
  previousPersonId: number
  /** PersonId of the new blank record (live) that will receive the restored history. */
  currentPersonId: number
  /** PrimaryAliasId of the new blank record (live). Auto-resolved from currentPersonId. */
  currentPersonAliasId: number
  /** PersonId of the person in live who incorrectly received the merged data
   *  (i.e., whose record currently has the previous person's aliases pointing at them).
   *  Used by the engine for a defensive verification check; not used in the actual
   *  data-movement SQL. */
  wrongRecipientPersonId: number
}

export interface VerificationResult {
  /** Distinct PersonId values currently associated with the previous person's
   *  aliases in the LIVE PersonAlias table. */
  aliasCurrentRecipientIds: number[]
  /** True iff aliasCurrentRecipientIds is exactly [wrongRecipientPersonId]. */
  matchesWrongRecipient: boolean
  /** Human-readable note when verification didn't match cleanly. */
  message: string | null
}

/** Per-column plan for restoring profile basics from backup onto the new
 *  blank record in live. A column is included only when backup has a value
 *  to copy (NULL/empty/0-Unknown are skipped). */
export interface ProfileFieldRestore {
  column: string
  backupValue: string | number | null
  liveValue: string | number | null
  /** True when liveValue is non-blank — we'll be replacing existing data. */
  willOverwrite: boolean
}

export interface ProfileRestorePlan {
  personUpdates: ProfileFieldRestore[]
  /** PhoneNumber.Id values from backup (mobile-type only) that originally
   *  belonged to the previous person and will be repointed onto the new blank
   *  record's PersonId in live. */
  mobilePhoneIds: number[]
}

export interface AnalyzeResult {
  backupPerson: PersonRecord | null
  livePerson: PersonRecord | null
  wrongRecipientPerson: PersonRecord | null
  previousAliasIds: number[]
  groupMemberIds: number[]
  attributeValueIds: number[]
  userLoginIds: number[]
  /** History.Id values from backup whose EntityTypeId=15 and EntityId=previous.
   *  These are audit-trail rows *about* the unmerge target, repointed back to
   *  the new blank record's PersonId. */
  historyAboutPersonIds: number[]
  affectedTables: AffectedTable[]
  profileRestore: ProfileRestorePlan
  totals: {
    groupMemberUpdates: number
    attributeValueUpdates: number
    userLoginUpdates: number
    aliasReferenceUpdates: number
    profileColumnUpdates: number
    mobilePhoneUpdates: number
    historyEntityUpdates: number
  }
  verification: VerificationResult
  sqlLog: string[]
}

export interface CommitResult extends AnalyzeResult {
  committed: boolean
  startedAt: string
  finishedAt: string
  errorMessage?: string
  /** Absolute path to the audit log written for this commit (success or failure). */
  auditLogPath?: string
  /** Bare filename for display. */
  auditLogFilename?: string
}

/** Engine progress event, streamed via IPC during analyze/commit. */
export interface UnmergeProgress {
  step:
    | 'read-backup'
    | 'verify-recipients'
    | 'discover-schema'
    | 'count-impacts'
    | 'fetch-backup-row-ids'
    | 'write-group-member'
    | 'write-attribute-value'
    | 'write-user-login'
    | 'write-history-entity'
    | 'write-alias-references'
    | 'write-profile-restore'
    | 'finalize-rollback'
    | 'finalize-commit'
  detail?: string
}

// Test mode -------------------------------------------------------------

export type AppMode = 'production' | 'test'

export interface TestDbStatus {
  livePath: string | null
  backupPath: string | null
  exists: boolean
}

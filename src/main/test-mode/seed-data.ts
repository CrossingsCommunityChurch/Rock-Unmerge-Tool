// Test scenario seed: Alice was accidentally merged into Bob.
//
// IDs are deliberately spaced so a human reading the data can tell at a
// glance what each record is for:
//   Person:           1 = Alice, 2 = Bob, 3 = Alice (recreated shell, live only)
//   PersonAlias:      10/11 = Alice, 20 = Bob, 21 = Alice's recreated shell
//   Group:            1 = Family (GroupTypeId 10), 2 = Small Group, 3 = Volunteers
//   GroupMember:      100 = Alice in Family, 101 = Alice in 2, 102 = Alice in 3
//                     150 = Bob in Family, 151 = Bob in 2
//   Attribute:        50/51/52 = Person attributes (EntityTypeId 15),
//                     53 = non-person attribute (EntityTypeId 99 — must be ignored)
//   AttributeValue:   200/201/202 = Alice's values, 250 = Bob's value,
//                     299 = a non-person attribute value pointing at Alice's id
//                     (defense-in-depth check should refuse to touch it)
//   UserLogin:        300 = Alice, 301 = Bob
//   Attendance:       400/401 = Alice (pre-merge), 402 = Bob (pre-merge),
//                     403 = post-merge attendance booked under Alice's old alias
//                           (this row exists in LIVE only — must be left alone
//                           by the unmerge to honor the original script's
//                           safer JOIN semantics)
//   FinancialTransaction: 500 = Alice, 550 = Bob
//   Note:             600 = Alice (PersonAliasId), 601 = Bob; 602 = Created
//                           BY Alice on Bob's record (CreatedByPersonAliasId
//                           only — must NOT be repointed)
//   History:          700 = Alice (PersonAliasId), 701 = Alice as related,
//                     750 = Bob

import type { Database as Db } from 'better-sqlite3'
import { applyMerge } from './merge-simulator'

const ISO = '2025-01-15T10:00:00'

export interface SeedRowCounts {
  person: number
  personAlias: number
  groupMember: number
  attributeValue: number
  userLogin: number
  phoneNumber: number
  attendance: number
  financialTransaction: number
  note: number
  history: number
}

/** Seed the BACKUP database — pre-merge state with both Alice and Bob intact. */
export function seedBackup(db: Db): SeedRowCounts {
  insertCommonReferenceData(db)

  // BinaryFile rows representing profile photos. These exist in both backup
  // and live (Rock typically doesn't hard-delete BinaryFile during a merge),
  // which is what lets the unmerge restore Alice's PhotoId without an FK fail.
  db.prepare(
    `INSERT INTO [BinaryFile](Id, FileName, MimeType)
     VALUES (500, 'alice-headshot.jpg', 'image/jpeg')`
  ).run()
  db.prepare(
    `INSERT INTO [BinaryFile](Id, FileName, MimeType)
     VALUES (501, 'bob-headshot.jpg', 'image/jpeg')`
  ).run()

  insertPerson(db, 1, 'Alice', 'Sample', 'Ali', 'alice@example.org', '1990-04-12', 1, /*RS*/ 3, 65, /*deceased*/ 0, 10, {
    graduationYear: 2008,
    maritalStatusValueId: 143,
    photoId: 500
  })
  insertPerson(db, 2, 'Bob', 'Sample', null, 'bob@example.org', '1985-09-30', 1, 3, 65, 0, 20, {
    graduationYear: 2003,
    maritalStatusValueId: 143,
    photoId: 501
  })

  // Ambient people — exercise the search UI and the RecordStatus pill colors.
  // Same surnames to make name searches return multiple candidates.
  insertPerson(db, 4, 'Charlie', 'Sample', 'Chuck', 'charlie@example.org', '1978-02-08', 1, /*Active*/ 3, 65, 0, 40)
  insertPerson(db, 5, 'Dana', 'Smith', null, 'dana@example.org', '1992-11-22', 2, /*Inactive*/ 4, 66, 0, 50)
  insertPerson(db, 6, 'Ed', 'Smith', null, 'ed@example.org', '1955-06-14', 1, /*Active*/ 3, 65, /*Deceased*/ 1, 60)
  insertPerson(db, 7, 'Frank', 'Jones', 'Frankie', 'frank@example.org', '2001-03-30', 1, /*Pending*/ 5, 66, 0, 70)

  // Aliases
  insertAlias(db, 10, 1) // Alice primary
  insertAlias(db, 11, 1) // Alice secondary
  insertAlias(db, 20, 2) // Bob primary
  insertAlias(db, 40, 4) // Charlie
  insertAlias(db, 50, 5) // Dana
  insertAlias(db, 60, 6) // Ed
  insertAlias(db, 70, 7) // Frank

  // Family + groups
  insertGroupMember(db, 100, 1, 1) // Alice in Family (excluded from unmerge by GroupTypeId 10)
  insertGroupMember(db, 101, 2, 1) // Alice in Small Group
  insertGroupMember(db, 102, 3, 1) // Alice in Volunteers
  insertGroupMember(db, 150, 1, 2) // Bob in Family
  insertGroupMember(db, 151, 2, 2) // Bob in Small Group

  // Person attributes
  insertAttributeValue(db, 200, 50, 1, 'Birthday: 4/12') // Alice
  insertAttributeValue(db, 201, 51, 1, 'Hobbies: Reading') // Alice
  insertAttributeValue(db, 202, 52, 1, 'NotesField') // Alice
  insertAttributeValue(db, 250, 50, 2, 'Birthday: 9/30') // Bob
  // Non-person attribute (EntityTypeId 99) — must be ignored even if EntityId matches
  insertAttributeValue(db, 299, 53, 1, 'unrelated entity reference')

  // User logins
  insertUserLogin(db, 300, 1, 'alice.sample')
  insertUserLogin(db, 301, 2, 'bob.sample')

  // Phone numbers (NumberTypeValueId 12 = Mobile in Rock's default install)
  insertPhone(db, 350, /*PersonId*/ 1, /*type=Mobile*/ 12, '5551234567', '(555) 123-4567')
  insertPhone(db, 351, 2, 12, '5559876543', '(555) 987-6543')

  // Attendance
  insertAttendance(db, 400, 10, ISO)
  insertAttendance(db, 401, 11, ISO)
  insertAttendance(db, 402, 20, ISO)

  // Financial transactions
  insertFinancialTx(db, 500, 10, 50.0, ISO)
  insertFinancialTx(db, 550, 20, 100.0, ISO)

  // Notes
  insertNote(db, 600, 'Alice note', 'Some note', /*PersonAliasId*/ 10, /*EntityId*/ 1, /*CreatedBy*/ 20)
  insertNote(db, 601, 'Bob note', 'Other note', 20, 2, 20)
  insertNote(db, 602, 'Alice on Bob', 'Alice noted Bob', 20, 2, /*CreatedBy*/ 10)

  // History
  insertHistory(db, 700, /*PersonAliasId*/ 10, /*Related*/ null, 'Edit')
  insertHistory(db, 701, /*PersonAliasId*/ 20, /*Related*/ 10, 'Linked')
  insertHistory(db, 750, /*PersonAliasId*/ 20, /*Related*/ null, 'Edit')

  // History entries that are *about* Alice (EntityTypeId 15 = Person, EntityId 1).
  // These exercise the History.EntityId restore path.
  insertHistory(db, 800, /*PersonAliasId*/ 10, /*Related*/ null, 'Modify', 15, 1, 'Email changed')
  insertHistory(db, 801, /*PersonAliasId*/ 20, /*Related*/ null, 'Modify', 15, 1, 'Phone added')
  insertHistory(db, 802, /*PersonAliasId*/ 20, /*Related*/ null, 'Modify', 15, 1, 'Address updated')
  // Non-person history row pointing at EntityId 1 -- must NOT be touched by
  // the unmerge (defense-in-depth: filter by EntityTypeId = 15 on the live
  // update side).
  insertHistory(db, 803, /*PersonAliasId*/ 20, /*Related*/ null, 'Modify', 99, 1, 'Group marker change')

  return countAll(db)
}

/** Seed the LIVE database starting from backup state, then apply the merge.
 *  After the merge the user has recreated an empty Alice shell (Person 3,
 *  PrimaryAliasId 21) per the spec's "Phase 1". */
export function seedLive(db: Db): SeedRowCounts {
  // Start from a clean copy of the pre-merge state, then apply the merge.
  seedBackup(db)
  applyMerge(db, /*from*/ 1, /*to*/ 2)

  // === Post-merge activity ===============================================
  // Row 403 was created AFTER the merge by someone checking in under what
  // they thought was Bob (alias 10 still exists, points at Bob). The unmerge
  // tool MUST leave this row alone, because it never belonged to Alice.
  insertAttendance(db, 403, 10, '2025-02-01T10:00:00')

  // === User recreates Alice in Rock's web UI =============================
  // Truly blank — name only, so the profile-basics restore in the engine is
  // observable in the test seed (Email/BirthDate/Gender/etc come back).
  insertPerson(db, 3, 'Alice', 'Sample', null, null, null, null, 3, 65, 0, 21)
  insertAlias(db, 21, 3) // new primary alias for the recreated shell

  // === A second, unrelated "Alice Sample" already in live ================
  // Same name, different person — added in live only (post-backup) to force
  // the user to disambiguate when searching by name. Has no data attached
  // beyond the name and a primary alias.
  insertPerson(db, 8, 'Alice', 'Sample', null, null, null, null, 3, 65, 0, 80)
  insertAlias(db, 80, 8)

  return countAll(db)
}

// ------ row helpers --------------------------------------------------------

function insertCommonReferenceData(db: Db): void {
  // Groups
  db.prepare(
    `INSERT INTO [Group](Id, Name, GroupTypeId) VALUES (1, 'Sample Family', 10)`
  ).run()
  db.prepare(
    `INSERT INTO [Group](Id, Name, GroupTypeId) VALUES (2, 'Tuesday Small Group', 25)`
  ).run()
  db.prepare(
    `INSERT INTO [Group](Id, Name, GroupTypeId) VALUES (3, 'Volunteer Team', 25)`
  ).run()

  // Attributes (50–52 are person attributes, 53 is not)
  db.prepare(
    `INSERT INTO [Attribute](Id, Name, [Key], EntityTypeId) VALUES (50, 'Birthday Note', 'BirthdayNote', 15)`
  ).run()
  db.prepare(
    `INSERT INTO [Attribute](Id, Name, [Key], EntityTypeId) VALUES (51, 'Hobbies', 'Hobbies', 15)`
  ).run()
  db.prepare(
    `INSERT INTO [Attribute](Id, Name, [Key], EntityTypeId) VALUES (52, 'Notes', 'Notes', 15)`
  ).run()
  db.prepare(
    `INSERT INTO [Attribute](Id, Name, [Key], EntityTypeId) VALUES (53, 'Group Marker', 'GroupMarker', 99)`
  ).run()
}

interface PersonExtras {
  graduationYear?: number | null
  maritalStatusValueId?: number | null
  photoId?: number | null
}

function insertPerson(
  db: Db,
  id: number,
  first: string,
  last: string,
  nick: string | null,
  email: string | null,
  birth: string | null,
  gender: number | null,
  recordStatus: number,
  connectionStatus: number,
  isDeceased: 0 | 1,
  primaryAliasId: number,
  extras: PersonExtras = {}
): void {
  // Derive BirthMonth/Day/Year from BirthDate (Rock stores all four).
  let bm: number | null = null
  let bd: number | null = null
  let by: number | null = null
  if (birth) {
    const parts = birth.split('-')
    by = Number(parts[0]) || null
    bm = Number(parts[1]) || null
    bd = Number(parts[2]) || null
  }
  db.prepare(
    `INSERT INTO [Person]
       (Id, FirstName, LastName, NickName, Email, BirthDate,
        BirthMonth, BirthDay, BirthYear,
        Gender, GraduationYear, MaritalStatusValueId, PhotoId,
        RecordStatusValueId, ConnectionStatusValueId, IsDeceased,
        CreatedDateTime, ModifiedDateTime, PrimaryAliasId)
     VALUES (@id, @f, @l, @n, @e, @b, @bm, @bd, @by, @g, @gy, @ms, @ph,
             @rs, @cs, @dec, @c, @m, @pa)`
  ).run({
    id,
    f: first,
    l: last,
    n: nick,
    e: email,
    b: birth,
    bm,
    bd,
    by,
    g: gender,
    gy: extras.graduationYear ?? null,
    ms: extras.maritalStatusValueId ?? null,
    ph: extras.photoId ?? null,
    rs: recordStatus,
    cs: connectionStatus,
    dec: isDeceased,
    c: ISO,
    m: ISO,
    pa: primaryAliasId
  })
}

function insertAlias(db: Db, id: number, personId: number): void {
  db.prepare(
    `INSERT INTO [PersonAlias](Id, PersonId, AliasPersonId, Guid)
     VALUES (@id, @p, @p, @g)`
  ).run({ id, p: personId, g: `alias-${id}` })
}

function insertGroupMember(db: Db, id: number, groupId: number, personId: number): void {
  db.prepare(
    `INSERT INTO [GroupMember](Id, GroupId, PersonId, GroupRoleId)
     VALUES (@id, @gid, @pid, 1)`
  ).run({ id, gid: groupId, pid: personId })
}

function insertAttributeValue(
  db: Db,
  id: number,
  attributeId: number,
  entityId: number,
  value: string
): void {
  db.prepare(
    `INSERT INTO [AttributeValue](Id, AttributeId, EntityId, Value)
     VALUES (@id, @aid, @eid, @v)`
  ).run({ id, aid: attributeId, eid: entityId, v: value })
}

function insertUserLogin(db: Db, id: number, personId: number, username: string): void {
  db.prepare(
    `INSERT INTO [UserLogin](Id, PersonId, UserName) VALUES (@id, @p, @u)`
  ).run({ id, p: personId, u: username })
}

function insertPhone(
  db: Db,
  id: number,
  personId: number,
  numberTypeValueId: number,
  number: string,
  numberFormatted: string
): void {
  db.prepare(
    `INSERT INTO [PhoneNumber]
       (Id, PersonId, NumberTypeValueId, Number, NumberFormatted, CountryCode,
        IsMessagingEnabled, IsUnlisted)
     VALUES (@id, @p, @t, @n, @nf, '1', 1, 0)`
  ).run({ id, p: personId, t: numberTypeValueId, n: number, nf: numberFormatted })
}

function insertAttendance(
  db: Db,
  id: number,
  personAliasId: number,
  startDateTime: string
): void {
  db.prepare(
    `INSERT INTO [Attendance](Id, PersonAliasId, StartDateTime)
     VALUES (@id, @pa, @s)`
  ).run({ id, pa: personAliasId, s: startDateTime })
}

function insertFinancialTx(
  db: Db,
  id: number,
  authorizedAliasId: number,
  amount: number,
  dt: string
): void {
  db.prepare(
    `INSERT INTO [FinancialTransaction]
       (Id, AuthorizedPersonAliasId, Amount, TransactionDateTime)
     VALUES (@id, @a, @amt, @d)`
  ).run({ id, a: authorizedAliasId, amt: amount, d: dt })
}

function insertNote(
  db: Db,
  id: number,
  caption: string,
  text: string,
  personAliasId: number,
  entityId: number,
  createdByPersonAliasId: number
): void {
  db.prepare(
    `INSERT INTO [Note](Id, Caption, Text, PersonAliasId, EntityId, CreatedByPersonAliasId)
     VALUES (@id, @c, @t, @pa, @e, @cb)`
  ).run({ id, c: caption, t: text, pa: personAliasId, e: entityId, cb: createdByPersonAliasId })
}

function insertHistory(
  db: Db,
  id: number,
  personAliasId: number | null,
  relatedPersonAliasId: number | null,
  verb: string,
  /** When this entry is "about" an entity (e.g., a Person), set EntityTypeId
   *  + EntityId. EntityTypeId 15 = Person in a default Rock install. */
  entityTypeId: number | null = null,
  entityId: number | null = null,
  caption: string | null = null
): void {
  db.prepare(
    `INSERT INTO [History]
       (Id, EntityTypeId, EntityId, Caption, PersonAliasId, RelatedPersonAliasId, Verb)
     VALUES (@id, @et, @e, @cap, @pa, @rp, @v)`
  ).run({
    id,
    et: entityTypeId,
    e: entityId,
    cap: caption,
    pa: personAliasId,
    rp: relatedPersonAliasId,
    v: verb
  })
}

function countAll(db: Db): SeedRowCounts {
  const c = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
  return {
    person: c('SELECT COUNT(*) AS n FROM [Person]'),
    personAlias: c('SELECT COUNT(*) AS n FROM [PersonAlias]'),
    groupMember: c('SELECT COUNT(*) AS n FROM [GroupMember]'),
    attributeValue: c('SELECT COUNT(*) AS n FROM [AttributeValue]'),
    userLogin: c('SELECT COUNT(*) AS n FROM [UserLogin]'),
    phoneNumber: c('SELECT COUNT(*) AS n FROM [PhoneNumber]'),
    attendance: c('SELECT COUNT(*) AS n FROM [Attendance]'),
    financialTransaction: c('SELECT COUNT(*) AS n FROM [FinancialTransaction]'),
    note: c('SELECT COUNT(*) AS n FROM [Note]'),
    history: c('SELECT COUNT(*) AS n FROM [History]')
  }
}

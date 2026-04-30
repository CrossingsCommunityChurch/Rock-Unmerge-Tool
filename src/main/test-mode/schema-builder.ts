// Test-mode schema. A minimal subset of Rock RMS tables, structured so that
// the unmerge engine has something realistic to discover and operate on.
//
// Discovery filter expectations (must produce these and only these):
//   Attendance.PersonAliasId
//   FinancialTransaction.AuthorizedPersonAliasId
//   History.PersonAliasId
//   History.RelatedPersonAliasId
//   Note.PersonAliasId
//
// GroupMember is excluded by table-name pattern. CreatedBy*/ModifiedBy*
// columns are excluded by column-name prefix and exist on several tables to
// validate the filter.

import type { Database as Db } from 'better-sqlite3'

export const DDL = [
  `CREATE TABLE [Person] (
     Id INTEGER PRIMARY KEY,
     FirstName TEXT,
     LastName TEXT,
     NickName TEXT,
     Email TEXT,
     BirthDate TEXT,
     BirthMonth INTEGER,
     BirthDay INTEGER,
     BirthYear INTEGER,
     Gender INTEGER,
     GraduationYear INTEGER,
     MaritalStatusValueId INTEGER,
     PhotoId INTEGER,
     RecordStatusValueId INTEGER,
     ConnectionStatusValueId INTEGER,
     IsDeceased INTEGER NOT NULL DEFAULT 0,
     CreatedDateTime TEXT,
     ModifiedDateTime TEXT,
     PrimaryAliasId INTEGER
   )`,

  `CREATE TABLE [BinaryFile] (
     Id INTEGER PRIMARY KEY,
     FileName TEXT,
     MimeType TEXT
   )`,

  `CREATE TABLE [PhoneNumber] (
     Id INTEGER PRIMARY KEY,
     PersonId INTEGER NOT NULL,
     NumberTypeValueId INTEGER,
     Number TEXT,
     NumberFormatted TEXT,
     CountryCode TEXT,
     IsMessagingEnabled INTEGER NOT NULL DEFAULT 0,
     IsUnlisted INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE [PersonAlias] (
     Id INTEGER PRIMARY KEY,
     PersonId INTEGER NOT NULL,
     AliasPersonId INTEGER,
     Guid TEXT
   )`,

  `CREATE TABLE [Group] (
     Id INTEGER PRIMARY KEY,
     Name TEXT,
     GroupTypeId INTEGER NOT NULL
   )`,

  `CREATE TABLE [GroupMember] (
     Id INTEGER PRIMARY KEY,
     GroupId INTEGER NOT NULL,
     PersonId INTEGER NOT NULL,
     GroupRoleId INTEGER
   )`,

  `CREATE TABLE [Attribute] (
     Id INTEGER PRIMARY KEY,
     Name TEXT,
     [Key] TEXT,
     EntityTypeId INTEGER
   )`,

  `CREATE TABLE [AttributeValue] (
     Id INTEGER PRIMARY KEY,
     AttributeId INTEGER NOT NULL,
     EntityId INTEGER,
     Value TEXT
   )`,

  `CREATE TABLE [UserLogin] (
     Id INTEGER PRIMARY KEY,
     PersonId INTEGER NOT NULL,
     UserName TEXT
   )`,

  `CREATE TABLE [Attendance] (
     Id INTEGER PRIMARY KEY,
     PersonAliasId INTEGER NOT NULL,
     StartDateTime TEXT,
     CreatedByPersonAliasId INTEGER,
     ModifiedByPersonAliasId INTEGER
   )`,

  `CREATE TABLE [FinancialTransaction] (
     Id INTEGER PRIMARY KEY,
     AuthorizedPersonAliasId INTEGER NOT NULL,
     Amount REAL,
     TransactionDateTime TEXT,
     CreatedByPersonAliasId INTEGER
   )`,

  `CREATE TABLE [Note] (
     Id INTEGER PRIMARY KEY,
     Caption TEXT,
     Text TEXT,
     PersonAliasId INTEGER,
     EntityId INTEGER,
     CreatedByPersonAliasId INTEGER
   )`,

  `CREATE TABLE [History] (
     Id INTEGER PRIMARY KEY,
     EntityTypeId INTEGER,
     EntityId INTEGER,
     Caption TEXT,
     PersonAliasId INTEGER,
     RelatedPersonAliasId INTEGER,
     Verb TEXT,
     CreatedByPersonAliasId INTEGER
   )`
]

export function applySchema(db: Db): void {
  db.exec('PRAGMA foreign_keys = OFF') // we control referential integrity manually
  for (const ddl of DDL) db.exec(ddl)
}

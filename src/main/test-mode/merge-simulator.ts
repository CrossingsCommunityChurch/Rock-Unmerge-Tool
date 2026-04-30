// Apply a fake merge to a SQLite test database.
//
// Mirrors what Rock RMS does when Person `from` is merged into Person `to`:
//   - the `from` Person row is deleted
//   - the `from` PersonAlias rows survive but their PersonId is repointed at `to`
//   - GroupMember.PersonId, AttributeValue.EntityId (for person attributes),
//     and UserLogin.PersonId rows that referenced `from` are repointed at `to`
//
// All PersonAliasId-bearing tables (Attendance, FinancialTransaction, Note,
// History, ...) are NOT touched directly by the merge — those references
// follow the alias table automatically once the aliases are repointed.

import type { Database as Db } from 'better-sqlite3'

export function applyMerge(db: Db, fromPersonId: number, toPersonId: number): void {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE [PersonAlias] SET PersonId = @to WHERE PersonId = @from`).run({
      from: fromPersonId,
      to: toPersonId
    })
    db.prepare(`UPDATE [GroupMember] SET PersonId = @to WHERE PersonId = @from`).run({
      from: fromPersonId,
      to: toPersonId
    })
    db.prepare(
      `UPDATE [AttributeValue] SET EntityId = @to
         WHERE EntityId = @from
           AND AttributeId IN (SELECT Id FROM [Attribute] WHERE EntityTypeId = 15)`
    ).run({ from: fromPersonId, to: toPersonId })
    db.prepare(`UPDATE [UserLogin] SET PersonId = @to WHERE PersonId = @from`).run({
      from: fromPersonId,
      to: toPersonId
    })
    db.prepare(`UPDATE [PhoneNumber] SET PersonId = @to WHERE PersonId = @from`).run({
      from: fromPersonId,
      to: toPersonId
    })
    // History entries about the merged person (EntityTypeId 15 = Person) get
    // their EntityId moved to the merge target.
    db.prepare(
      `UPDATE [History] SET EntityId = @to
         WHERE EntityTypeId = 15 AND EntityId = @from`
    ).run({ from: fromPersonId, to: toPersonId })
    db.prepare(`DELETE FROM [Person] WHERE Id = @from`).run({ from: fromPersonId })
  })
  tx()
}

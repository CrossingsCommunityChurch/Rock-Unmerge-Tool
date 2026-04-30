# Rock Unmerge Tool

A guided desktop application for recovering from accidental person merges in
[Rock RMS](https://www.rockrms.com/). Replaces a manual SQL script with a
five-step wizard that connects to a live database and a point-in-time backup,
previews the impact of an unmerge, and commits the change inside a single
transaction with full audit logging.

> **Status**: pre-1.0 internal tool. Engine is feature-complete and validated
> against synthetic test data. First production use should be against a
> PITR-vs-PITR test pair (see *Validation* below).

---

## What it does

When Rock merges Person A into Person B, A's row is deleted, A's `PersonAlias`
rows are repointed at B, and every attendance, gift, group membership, login,
and note A ever had now reads as B's. This tool reverses that:

1. Connects to the **live** database (where the merge happened) and a
   **backup** taken before the merge.
2. Reads A's original alias IDs from the backup.
3. Discovers every table in live with a `PersonAliasId` column and counts
   what would be repointed.
4. Repoints those references to a fresh blank record you've recreated for A
   in Rock — *and only the rows that pre-dated the merge*. Activity that
   happened on B's record after the merge stays attributed to B (defensible
   default; you can fix individual rows by hand later).
5. Restores A's profile basics from the backup onto the new blank record:
   `Email`, `Gender`, `BirthDate`, `GraduationYear`, `MaritalStatusValueId`,
   `PhotoId`, and any mobile-type `PhoneNumber` rows.
6. Writes a per-commit audit log to `<userData>/audit-logs/`.

All writes happen in a single transaction on the live connection. The backup
connection is read-only. See
[`reference/Unmerge_Person_with_Alias_Detection.sql`](reference/Unmerge_Person_with_Alias_Detection.sql)
for the original SQL script (Pastor Jeremy Parker) whose semantics this tool
preserves.

---

## Install (end users)

**[Go to the latest release →](https://github.com/CrossingsCommunityChurch/Rock-Unmerge-Tool/releases/latest)**

On that page, scroll down to the "Assets" section and click the file for
your operating system:

| Your machine | Click this file |
|---|---|
| Mac with Apple Silicon (M1/M2/M3/M4 — most Macs since 2020) | `Rock Unmerge Tool-x.y.z-mac-arm64.dmg` |
| Mac with Intel chip | `Rock Unmerge Tool-x.y.z-mac-x64.dmg` |
| Windows (most users) | `Rock Unmerge Tool-x.y.z-win-x64.exe` |
| Windows on ARM | `Rock Unmerge Tool-x.y.z-win-arm64.exe` |

> Not sure which Mac you have? Apple menu → About This Mac → look for
> "Apple M…" (Apple Silicon) or "Intel" under Chip / Processor.

> Older versions are at the [full releases page](https://github.com/CrossingsCommunityChurch/Rock-Unmerge-Tool/releases).

### Running the installer

#### macOS

1. Open the downloaded `.dmg` and drag **Rock Unmerge Tool** into your
   Applications folder.
2. **First launch**: macOS will say *"Rock Unmerge Tool cannot be opened
   because Apple cannot check it for malicious software."* This is because
   the build isn't signed by a Developer ID (yet). To open it:
   - Right-click the app in Applications → **Open** → click **Open** in the
     dialog. *(Doing it from the Finder context menu, not double-click, is
     what bypasses Gatekeeper for unsigned apps.)*
   - Subsequent launches work normally.
   - Alternative: System Settings → Privacy & Security → scroll to
     "Rock Unmerge Tool was blocked..." → click **Open Anyway**.

#### Windows

1. Run the downloaded `.exe`. **Microsoft Defender SmartScreen** will say
   *"Windows protected your PC"* because the binary isn't signed by a
   verified publisher (yet). To proceed:
   - Click **More info** in the dialog.
   - Click **Run anyway**.
2. Choose an install location (the installer lets you pick) and finish.

### Why the warnings?

The installers aren't yet signed with paid Apple / Microsoft developer
certificates. Once we add code signing the warnings disappear. Until then,
the click-through above is a one-time cost per machine.

---

## Validation before first production use

The first time you point this tool at real Rock data, do it against a
**PITR-vs-PITR** pair, not actual production:

1. From the Azure portal, restore the live Rock database to a new database
   `Rock-prod_unmerge_test_<date>` using a recent point-in-time.
2. Restore the same database to `Rock-prod_unmerge_backup_<earlier-date>`
   using a point-in-time **before** the accidental merge.
3. Configure the tool with the test restore as **Live** and the earlier
   restore as **Backup**.
4. Walk through Connect → Identify → Preview. Compare the "Tables affected"
   counts to manual SQL queries you write yourself for 2–3 spot tables.
5. If counts agree, run **Commit** against the test pair. Open Rock pointed
   at the test database and verify the restored person's record looks right.
6. Only then point the tool at actual production with a fresh backup.

The audit log makes the operation reproducible and reviewable after the fact.

---

## Build from source

Requires **Node 22+** (run `nvm use` to pick up `.nvmrc`) and a checkout of
this repo. Native modules (`better-sqlite3`, `mssql`) build automatically on
`npm install` via `electron-builder install-app-deps`.

```bash
nvm use 22
npm install
npm run dev          # launches the app with hot reload
```

### Producing installers

```bash
npm run build:icon   # regenerate build/icon.png from the SVG (only if you change the design)
npm run build:mac    # → dist/Rock-Unmerge-Tool-x.y.z-mac-{arm64,x64}.dmg
npm run build:win    # → dist/Rock-Unmerge-Tool-x.y.z-win-{x64,arm64}.exe
npm run build:all    # build mac + windows installers in one go (must run on macOS)
```

`npm run build:all` requires a macOS host because building the Mac `.dmg`
needs `hdiutil`. Building the Windows `.exe` from macOS works fine for
unsigned NSIS installers.

### Test mode

The app ships a Test Mode that creates two synthetic SQLite databases under
`<userData>/test-data/` seeded with an "Alice merged into Bob" scenario:
2 PersonAlias rows, 5 alias-bearing tables, a deliberate post-merge
Attendance row to validate the safer-JOIN-by-Id semantics, and profile data
on Alice's backup record (graduation year, marital status, mobile phone,
profile picture). Use **Test Mode** from the gear icon during development;
**Reset Test Data** restores the pre-unmerge state at any time.

---

## Tech

- Electron 33 + electron-vite + React 18 + TypeScript (strict context isolation)
- Tailwind CSS + shadcn-style UI primitives
- `mssql` for SQL Server / Azure SQL
- `better-sqlite3` for Test Mode
- `electron-store` + Electron `safeStorage` for encrypted profile storage
- `electron-builder` for cross-platform installers

---

## Credits

This tool wraps and extends
[`Unmerge_Person_with_Alias_Detection.sql`](reference/Unmerge_Person_with_Alias_Detection.sql)
by **Pastor Jeremy Parker**. The engine's bridge-mode TypeScript
implementation preserves that script's semantics step-for-step; the
extensions (profile-basics restore, mobile phone restore, History.EntityId
restore, defensive verification) are layered on top with the original
behavior left intact.

Built at Crossings Church to recover from accidental Rock RMS person merges.
Released under the [GNU GPL v3](LICENSE) for the broader Rock community.
Anyone is free to use, modify, and redistribute this tool — derivative works
must remain under the same license, which keeps the tool free for everyone
and prevents repackaging as a closed-source paid product.

## Disclaimer

You are responsible for taking a fresh backup of the live database before
running a commit-mode unmerge. The tool produces an audit log for every
commit run; review it. Always run against a PITR-vs-PITR test pair before
pointing at production — see *Validation* above.

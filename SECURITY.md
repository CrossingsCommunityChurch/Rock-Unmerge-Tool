# Security policy

## Reporting a vulnerability

If you find a security issue in Rock Unmerge Tool, please report it
**privately** rather than opening a public issue on GitHub. Send details to
the maintainer at Crossings Church and we'll work on a fix before disclosing.

Things worth flagging:

- SQL injection paths we missed (the engine validates identifiers and
  parameterizes every query, but report anything you can construct that
  injects)
- Audit log content disclosure (`<userData>/audit-logs/` is local to the
  user, but any path traversal etc.)
- Profile credential storage issues — passwords are encrypted with Electron
  `safeStorage` and intentionally don't roam, but report anything that
  bypasses this
- Anything that could let the tool write to the backup database (the backup
  connection is treated as read-only by design)

## What this tool does, briefly

The tool connects to two SQL Server / Azure SQL databases (live + backup),
reads from both, and writes to the live one inside a single transaction. It
never opens network sockets to anywhere else. Audit logs and profile config
live under the OS user's app-data directory and are not transmitted.

## Out of scope

- Anything requiring admin credentials on the host machine — the tool runs
  with the current user's privileges and treats them as trusted.
- Misuse by a user with valid SQL credentials. The credentials, not the
  tool, are the privileged actor here.

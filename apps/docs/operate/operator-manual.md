# Operator manual

## Staff ranks

| Rank | Value | Can |
| :--- | :--- | :--- |
| Moderator | 1 | Review and resolve reports, look up accounts, audit and quarantine files |
| Admin | 2 | Also suspend and restore accounts of lower rank, and hide beacons from Discovery |
| Root | 3 | Also set other people's staff rank |

The first rank is set in the database ([Deployment](/operate/deployment#_5-first-staff-account)). After that, root staff change ranks through the API (`PATCH /api/v1/console/transmitters/:id/staff-rank` with `{ "staffRank": 0-3 }`); the console does not show this yet. Staff see **Command Console** under User Settings → Instance Staff. Nobody can act on someone of equal or higher rank.

## Command Console

**Reports.** Members report transmissions, people and beacons from their context menus, with a reason and details. The report keeps a snapshot of the reported content, so deleting it afterwards does not hide it from you. Resolve or dismiss each one.

**Transmitters.** Search accounts by name or tag.

- **Suspend** (admin) signs the person out on every device at once and blocks sign-in; they see "This account has been suspended".
- **Restore** undoes it.

**Storage.** Quarantine a file to take its public link offline immediately; it no longer loads anywhere it was posted.

## Instance rules (Subspace Directives)

Everyone accepts the Directives when signing up, and again when they change. Edit them in `packages/constants` (`SUBSPACE_DIRECTIVES`) and raise the `version` to ask everyone to agree again.

## What staff can and cannot see

Staff can review reported content and any file in storage; the first-upload notice tells people so. Staff cannot read end-to-end encrypted conversations or encrypted call media. The server only has ciphertext.

## Good practice

- Give the fewest people root.
- Watch the reports queue daily.
- Keep [backups](/operate/backups) current.
- Run `pnpm test:live` against your instance after every update.

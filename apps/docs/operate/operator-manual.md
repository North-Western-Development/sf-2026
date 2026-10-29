# Operator manual

## Staff ranks

Staff ranks are made in the Command Console (**Team → Staff Ranks**). Each has a name, a color, an optional badge and a set of permissions:

| Permission | Lets them |
| :--- | :--- |
| Review reports | See reports and resolve or dismiss them |
| Quarantine | Stop an account posting, DMing or joining beacons while it keeps reading |
| Suspend | Sign an account out everywhere and keep it out |
| Moderate the Vault | See uploaded files and quarantine them |
| Manage storage | Create storage groups and move accounts between them |
| Moderate discovery | Take beacons out of Discovery |
| Manage badges | Create custom badges and give or take them |
| Manage staff | Give and take ranks below their own, and create, edit, reorder and delete those ranks |
| View the staff log | Read the log of every staff action |

Every staff member can open the console, look up accounts and see who else is staff.

Ranks are ordered, highest first. Staff only act on accounts and ranks **below their own**, and can never grant a permission they do not have. Three ranks come built in: **Root** (always every permission, cannot be deleted), **Admin** and **Moderator**, which you can edit or delete. A deleted rank's holders leave staff.

The first Root is set in the database ([Deployment](/operate/deployment#_5-first-staff-account)). After that, give ranks from **Transmitters** (the Staff rank menu on each account) or **Team → Staff → Add Staff Member**. Staff see **Command Console** under User Settings → Instance Staff.

## Command Console

**Reports.** Members report transmissions, people and beacons from their context menus, with a reason and details. The report keeps a snapshot of the reported content, so deleting it afterwards does not hide it from you. Resolve or dismiss each one.

- **From an encrypted conversation:** the report shows the reported transmission and up to five on each side, each marked Verified, Not verifiable or Not shared. Encrypted attachments open here and are decrypted in your browser. See [Reporting an encrypted message](/guide/security#reporting-an-encrypted-message).
- **About a beacon, or a transmission in one:** while the report is open, **Read Beacon** shows that beacon's relays read-only, hidden ones included. You never join it: there is no membership, presence or typing, so members cannot see you. Each relay you open is written to the Staff Log.

**Transmitters.** Search accounts by part of a username or display name.

- **Quarantine** keeps them reading but stops them posting, DMing anyone new or joining beacons.
- **Suspend** signs the person out on every device at once and blocks sign-in; they see "This account has been suspended".
- The award button opens their hand-awarded badges, to give or take.

**Storage.** Quarantine a file to take its public link offline immediately; it no longer loads anywhere it was posted.

**Badges.** Custom badges sit next to the built-in ones on profiles. Upload a small square icon (PNG, GIF or WebP up to 256 KB; it shows at 18 px) and choose how it is earned:

- **Given by staff**: staff give and take it, here (Holders) or from an account on Transmitters.
- **Worn by a staff rank**: pick it for a rank under Staff Ranks. Everyone holding the rank wears it in place of the standard Staff badge, and loses it with the rank.
- **Account age**, **Messages sent** or **Time in voice**: everyone past the threshold gets it the next time their profile is viewed.

**Staff Log.** Every console action (reports, quarantines, suspensions, storage, ranks, badges), who took it and when. It holds no network addresses.

## Instance rules (Subspace Directives)

Everyone accepts the Directives when signing up, and again when they change. Edit them in `packages/constants` (`SUBSPACE_DIRECTIVES`) and raise the `version` to ask everyone to agree again.

## What staff can and cannot see

Staff can review reported content and any file in storage; the first-upload notice tells people so. Staff cannot read end-to-end encrypted conversations or encrypted call media: the server only has ciphertext. The exception is what a member chooses to share by reporting it, after being warned.

## Good practice

- Give the fewest people root.
- Watch the reports queue daily.
- Keep [backups](/operate/backups) current.
- Run `pnpm test:live` against your instance after every update.

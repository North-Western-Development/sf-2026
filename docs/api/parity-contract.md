# Discord-Parity API Contract (v1)

This contract is the source of truth for the backend work and the new web client.
Anything not listed here keeps its current behavior. All routes are under `/api/v1`,
authenticated with `Authorization: Bearer <access token>` unless marked **public**.

Conventions:
- IDs are UUIDs. Timestamps are ISO-8601 strings.
- Errors: `{ error: string, code?: string }` with the appropriate status. Never leak whether a
  resource exists to someone who cannot see it: use `404` for "not found or not visible".
- Every gateway dispatch is published through `publishGatewayEvent(app, type, payload, audience)`
  (`apps/api-service/src/lib/events.ts`). Audience rules are listed per event.
- Input validation uses Fastify JSON schemas (`schema: { body, params, querystring }`) with
  `additionalProperties: false`. Every new route gets one.
- **Channel** below means any message container. A channel is addressed by
  `(channelType, channelId)` where `channelType` is `relay | link | mesh | thread`.

---

## 1. Permissions

Add to `PERMISSIONS` in `packages/constants`:

| Flag | Bit | Purpose |
| --- | --- | --- |
| `ADD_REACTIONS` | `1n << 13n` | Add new reactions (reacting with an existing one needs only VIEW) |
| `MENTION_EVERYONE` | `1n << 14n` | `@everyone`, `@here`, and non-mentionable role pings |
| `CREATE_INVITES` | `1n << 15n` | Create invites |
| `MANAGE_BEACON` | `1n << 16n` | Edit beacon settings, view/revoke all invites |
| `CHANGE_NICKNAME` | `1n << 17n` | Change own nickname |
| `MANAGE_NICKNAMES` | `1n << 18n` | Change others' nicknames (hierarchy applies) |
| `READ_HISTORY` | `1n << 19n` | Read messages sent before joining the relay view |
| `MANAGE_GLYPHS` | `1n << 20n` | Create/rename/delete custom emojis |
| `MUTE_MEMBERS` | `1n << 21n` | Server-mute in Comm-Link |
| `MOVE_MEMBERS` | `1n << 22n` | Move/disconnect members in Comm-Link |
| `PIN_TRANSMISSIONS` | `1n << 23n` | Pin/unpin (MANAGE_TRANSMISSIONS also allows) |

`DEFAULT_EVERYONE_PERMISSIONS` gains `ADD_REACTIONS | CREATE_INVITES | CHANGE_NICKNAME | READ_HISTORY`.
Existing beacons: a data migration ORs those bits into every `@everyone` clearance.

### Relay overwrites (apply the existing `relay_overwrites` table)

Effective permissions for a member in a relay (Discord algorithm):
1. Owner or `ADMINISTRATOR` → all.
2. `base` = OR of member's clearances (incl. @everyone).
3. Apply the relay's `@everyone` overwrite (`deny` then `allow`).
4. Apply OR of all role overwrites for member's roles (`deny` then `allow`).
5. Apply the member overwrite (`deny` then `allow`).
6. If the relay has `permissionsSynced = true` and a `parentId`, use the parent category's overwrites instead of its own.

Implement once as `computeRelayPermissions(db, transmitterId, relayId)` in `packages/database/src/access.ts`
and use it everywhere a relay permission is checked, **including `resolveRelayAudience`**.
Add column `relays.permissions_synced boolean default true`.

Routes (`MANAGE_CLEARANCES` on the relay + hierarchy: cannot grant bits you do not have):
- `GET  /beacons/:beaconId/relays/:relayId/overwrites` → `{ overwrites: [{ targetId, targetType, allow, deny }] }` (bits as decimal strings)
- `PUT  /beacons/:beaconId/relays/:relayId/overwrites/:targetId` body `{ targetType, allow, deny }`
- `DELETE /beacons/:beaconId/relays/:relayId/overwrites/:targetId`
- `GET /beacons/:beaconId/relays` includes per relay `myPermissions` (decimal string) so the client can gate UI.
- Events: `RELAY_UPDATE` → beacon audience (members who could see the relay before OR after the change).

---

## 2. Messages

### Shape returned everywhere (`Transmission`)

```ts
{
  id, channelType, channelId,             // plus legacy relayId/threadId/p2pLinkId/meshId
  author: { id, username, discriminator, displayName, avatarUrl, displayColor, displayFont },
  member?: { nickname, clearanceIds, color },   // beacon relays/threads only; color = highest colored clearance
  content, createdAt, editedAt | null,
  attachments: [{ id, url, filename, size, mimeType, width?, height? }],
  mentions: string[],                     // user ids mentioned (<@id>)
  mentionRoles: string[],                 // clearance ids (<@&id>)
  mentionEveryone: boolean,               // only true if author had MENTION_EVERYONE
  replyTo: null | { id, author: {...}, content (<=200 chars), attachmentsCount, deleted: boolean },
  reactions: [{ emoji: EmojiKey, count, me: boolean }],
  pinned: boolean,
  type: 'default' | 'reply' | 'system_join' | 'system_pin'
}
```

`EmojiKey` is either a unicode emoji string or `custom:<glyphId>`; custom glyphs are returned with
`{ emoji, glyph: { id, name, url } }`.

### Content syntax
- User mention `<@uuid>`, role mention `<@&uuid>`, relay link `<#uuid>`, `@everyone`, `@here`, custom glyph `<:name:uuid>`.
- The server parses these on create/edit, validates ids (unknown or invisible ids are left as text and not stored as mentions), and strips `@everyone/@here` mention semantics when the author lacks `MENTION_EVERYONE`.
- Max length stays 2000.

### Routes (all containers)
- `GET  /channels/:channelType/:channelId/transmissions?before=&after=&around=&limit=` (limit 1-100, default 50; newest-last ordering in the response).
  Keep the existing per-container GET routes working as aliases.
- `POST /channels/:channelType/:channelId/transmissions` body `{ content?, attachmentIds?: uuid[], replyToId?, replyPing?: boolean (default true), nonce?: string }`
  - `content` or `attachmentIds` required. `attachmentIds` must be vault files owned by the sender (the server builds `attachments`; clients can no longer send raw URLs).
  - Relay: needs `SEND_TRANSMISSIONS`; attachments need `ATTACH_FILES`.
  - Link: existing affiliation / transmission-request gate applies. Mesh: membership. Thread: relay permission + thread not locked.
  - `nonce` is echoed back in the event for optimistic-send reconciliation.
- `PATCH /transmissions/:id` body `{ content }` — author only, any container. Sets `editedAt`, re-parses mentions.
- `DELETE /transmissions/:id` — author, or `MANAGE_TRANSMISSIONS` + hierarchy in relays/threads. Works in all containers.
- Events: `TRANSMISSION_CREATE | TRANSMISSION_UPDATE | TRANSMISSION_DELETE` with `{ channelType, channelId, transmission | transmissionId, nonce? }`. Audience = channel audience.

### Replies
Columns `transmissions.reply_to_id uuid null` (no FK cascade: deleted parents render as `deleted: true`),
`transmissions.reply_ping boolean default true`. A reply with `replyPing` adds the parent author to `mentions`
unless they are the sender.

### Reactions
Table `transmission_reactions(transmission_id, transmitter_id, emoji_key, created_at)` PK on all three.
- `PUT    /transmissions/:id/reactions/:emoji/@me` (URL-encoded emoji key). New emoji on a message needs `ADD_REACTIONS`; custom glyphs must belong to a beacon the user is in. Max 20 distinct emojis per message.
- `DELETE /transmissions/:id/reactions/:emoji/@me`
- `DELETE /transmissions/:id/reactions/:emoji/:userId` (`MANAGE_TRANSMISSIONS`)
- `GET    /transmissions/:id/reactions/:emoji?limit=100` → `{ users: [author shape] }`
- Events `REACTION_ADD | REACTION_REMOVE` `{ channelType, channelId, transmissionId, emoji, userId }` → channel audience.

### Pins
Columns `transmissions.pinned_at timestamptz null`, `pinned_by uuid null`. Max 250 pins per channel.
- `PUT /transmissions/:id/pin`, `DELETE /transmissions/:id/pin` — relays/threads: `PIN_TRANSMISSIONS` or `MANAGE_TRANSMISSIONS`; links/meshes: any participant.
- `GET /channels/:channelType/:channelId/pins` → `{ transmissions: Transmission[] }` newest pin first.
- Pinning inserts a `system_pin` message. Events `TRANSMISSION_UPDATE` + `CHANNEL_PINS_UPDATE { channelType, channelId, lastPinAt }`.

### Typing
- `POST /channels/:channelType/:channelId/typing` → 204. Requires send permission. Server-side throttle: at most one event per user per channel per 5s (Redis `SET NX EX 5`).
- Event `TYPING_START { channelType, channelId, userId, displayName, timestamp }` → channel audience minus the sender. Clients expire indicators after 10s or on that user's next `TRANSMISSION_CREATE`.

---

## 3. Read state, unread, mentions, notifications

### Read state
Table `read_states(transmitter_id, channel_type, channel_id, last_read_id uuid null, last_read_at timestamptz, mention_count int default 0)` PK `(transmitter_id, channel_type, channel_id)`.
Columns `last_transmission_id uuid`, `last_transmission_at timestamptz` on `relays`, `point_to_point_links`, `subspace_meshes`, `archival_threads` (updated on create/delete).

- `GET  /read-states` → `{ readStates: [{ channelType, channelId, lastReadId, lastReadAt, mentionCount }], channels: [{ channelType, channelId, beaconId?, lastTransmissionId, lastTransmissionAt }] }` covering every channel the user can see.
- `POST /channels/:channelType/:channelId/ack` body `{ transmissionId }` → sets last read, zeroes `mention_count`. Event `READ_STATE_UPDATE` → the user only (multi-device sync).
- `POST /beacons/:beaconId/ack` → acks every visible relay/thread in the beacon.
- On `TRANSMISSION_CREATE` the server increments `mention_count` for each recipient that is mentioned (direct, role, everyone/here if applicable, reply ping; every DM/mesh message counts as a mention for all other participants), **after** applying that recipient's notification settings suppressions and blocks.

### Notification settings
Table `notification_settings(transmitter_id, scope_type, scope_id, level, muted_until, suppress_everyone, suppress_roles, suppress_highlights, mobile_push, updated_at)`
PK `(transmitter_id, scope_type, scope_id)`.
- `scope_type`: `global | beacon | category | relay | link | mesh` (`scope_id` = `'@global'` for global).
- `level`: `all | mentions | nothing | inherit` (global defaults: DMs `all`, beacons `mentions` when > 100 members else `all`).
- `muted_until`: null = not muted, `'infinity'` = until turned off, or a timestamp (15m, 1h, 3h, 8h, 24h, forever presets are client-side).
- Resolution order: relay → category → beacon → global.
- `GET /notification-settings` → `{ settings: [...] }`
- `PUT /notification-settings/:scopeType/:scopeId` body (all optional) `{ level, mutedUntil, suppressEveryone, suppressRoles, suppressHighlights, mobilePush }`
- `DELETE /notification-settings/:scopeType/:scopeId` (reset to inherit)
- Event `NOTIFICATION_SETTINGS_UPDATE` → the user only.
- Presence `dnd` suppresses client notifications (sound/desktop) but not badges.

---

## 4. Presence & custom status

- Add `dnd` to `PRESENCE_STATES` (keep `away` for compatibility; the UI offers Online / Idle / Do Not Disturb / Invisible).
- Gateway mirrors every session's masked presence into Redis hash `presence` (`HSET presence <id> <state>`; `HDEL` when the last session closes) so the API can include presence.
- `transmitters.custom_status jsonb null` `{ text (<=128), emoji?: EmojiKey, expiresAt?: string }`.
- `PATCH /users/@me/status` body `{ customStatus: {...} | null }` → event `PRESENCE_UPDATE` to presence peers with `{ transmitter_id, presence, custom_status }`.
- `GET /beacons/:id/members` includes `presence` and `customStatus` per member (masked presence from Redis, `offline` if absent).
- Gateway `IDENTIFY` accepts `presence` in `online | idle | dnd | invisible`.

---

## 5. Direct messages, meshes, relationships

- `GET /links` → `{ links: [{ id, recipient: author shape + presence, lastTransmissionId, lastTransmissionAt }] }` sorted by activity.
- `POST /links` body `{ targetId }` → `{ link }` — opens (or returns) a link without sending anything. Allowed if affiliated, or sharing a beacon and not blocked. Otherwise `403 { code: 'LINK_NOT_ALLOWED' }`.
- `DELETE /links/:linkId` → hides the DM from the list for the caller (`point_to_point_link_hidden(transmitter_id, link_id)`); a new message un-hides it.
- The existing `POST /links/:targetId/transmissions` stays for the transmission-request flow.
- Meshes:
  - `GET /meshes` includes `members: [author shape]`, `lastTransmissionAt`.
  - `PATCH /meshes/:id` `{ name?, iconUrl? }` (members).
  - `POST /meshes/:id/members` `{ targetId }` — target must be affiliated with the caller and not blocking them.
  - `DELETE /meshes/:id/members/@me` (leave; ownership passes to the oldest member; last one out deletes the mesh).
  - `DELETE /meshes/:id/members/:userId` (owner only).
  - Creating a mesh has the same affiliation rule for every `memberIds` entry, and the list is de-duplicated.
  - Events `MESH_CREATE | MESH_UPDATE | MESH_DELETE` → members before and after.
- Relationships:
  - `GET /affiliations` → `{ relationships: [{ id, type: 'friend' | 'incoming' | 'outgoing' | 'blocked', user: author shape + presence, note?, since }] }`.
  - `POST /affiliations/request` accepts `{ username, discriminator }` or `{ targetId }`.
  - `DELETE /affiliations/:userId` — unfriend, or cancel/decline a pending request.
  - Blocking (`POST /blacklist` with `targetType: 'transmitter'`) also removes any friendship and pending requests.
  - Events `RELATIONSHIP_ADD | RELATIONSHIP_REMOVE` → both users. `TRANSMISSION_REQUEST_CREATE` includes the request with a sender profile.
  - `publishSessionRefresh` for both users on friend accept/remove/block.

---

## 6. Beacons: invites, bans, members, glyphs

### Invites
Table `invites(code text PK, beacon_id, relay_id null, inviter_id, max_uses int default 0, uses int default 0, max_age_seconds int default 604800, expires_at null, temporary boolean default false, created_at)`.
Codes: 8 random base62 characters.
- `POST /beacons/:id/invites` (`CREATE_INVITES`) `{ relayId?, maxUses? (0-100), maxAgeSeconds? (0 = never, or 1800|3600|21600|43200|86400|604800) }`
- `GET  /beacons/:id/invites` (`MANAGE_BEACON`) → all; otherwise only the caller's own.
- `DELETE /invites/:code` (inviter or `MANAGE_BEACON`)
- `GET  /invites/:code` **public** → `{ code, beacon: { id, name, iconUrl, bannerUrl, description, memberCount, onlineCount }, inviter: { username, discriminator, displayName } | null, expiresAt }`. Rate limited.
- `POST /invites/:code/accept` → joins (banned → `403 BANNED`; beacon blocked by the user → `403 BLOCKED`), increments uses, returns `{ beacon, requiresOnboarding }`.
- `POST /beacons/:id/join` is restricted to discoverable beacons.
- Event `MEMBER_ADD` → beacon audience; `BEACON_CREATE` → the joiner (full beacon payload).

### Bans
Table `beacon_bans(beacon_id, transmitter_id, reason null, banned_by, created_at)` PK `(beacon_id, transmitter_id)`.
- `PUT /beacons/:id/bans/:userId` `{ reason?, deleteMessageSeconds? (0-604800) }` (`BAN_MEMBERS` + hierarchy) → removes membership, optionally deletes their recent messages in the beacon.
- `DELETE /beacons/:id/bans/:userId`, `GET /beacons/:id/bans`.
- Events `MEMBER_REMOVE` → beacon audience + the banned user; `BEACON_DELETE { id, unavailable: false }` → the removed user.

### Members
- `PATCH /beacons/:id/members/@me` `{ nickname? (<=32, null clears), serverProfile? }` (`CHANGE_NICKNAME` for nickname).
- `PATCH /beacons/:id/members/:userId` `{ nickname?, clearanceIds? }` (`MANAGE_NICKNAMES` / `MANAGE_CLEARANCES` + hierarchy; cannot assign clearances at or above own highest).
- Events `MEMBER_UPDATE` → beacon audience.

### Beacon & relay change events
Every existing mutation route also publishes: `BEACON_UPDATE`, `BEACON_DELETE`, `RELAY_CREATE`, `RELAY_UPDATE`, `RELAY_DELETE`, `CLEARANCE_CREATE | CLEARANCE_UPDATE | CLEARANCE_DELETE`, `GLYPHS_UPDATE`, `MEMBER_ADD | MEMBER_UPDATE | MEMBER_REMOVE` (payloads = the updated object; audience = beacon members, filtered by relay visibility for relay events).

### Glyphs
- Uploads go through the media upload flow (section 7); routes store `url` only when it is an uploaded media URL.
- `MANAGE_GLYPHS` is required (currently unchecked).

---

## 7. Media uploads (file-service)

A second bucket `subspace-media` with an anonymous **read-only** policy, served at `/subspace-media/*`
by the web edge and the Vite proxy. Object keys are `<purpose>/<uuid>.<ext>` (unguessable).

- `POST /api/v1/media/upload-ticket` `{ purpose: 'avatar' | 'banner' | 'beacon_icon' | 'beacon_banner' | 'glyph' | 'mesh_icon', mimeType, sizeBytes }`
  → `{ uploadUrl, method: 'PUT', headers, mediaId, publicUrl, expiresInSeconds }`.
  Allowed types: png, jpeg, gif, webp. Limits: avatar 8 MB, banner 10 MB, beacon icon 8 MB, beacon banner 10 MB, glyph 256 KB, mesh icon 8 MB.
- `POST /api/v1/media/:mediaId/complete` → verifies the object exists with the declared size/type (HEAD), returns `{ publicUrl }`. Unverified uploads are never accepted by other routes.
- Every URL-valued profile/beacon/glyph field (`avatarUrl`, `bannerUrl`, `iconUrl`, glyph `url`) must be `null` or a completed media URL owned by the caller. Anything else → `400 INVALID_MEDIA_URL`. This closes arbitrary-URL injection into `<img src>` / CSS.
- Message attachments stay on the vault flow (`attachmentIds`).

---

## 8. Account

- `PATCH /auth/me/password` `{ currentPassword, newPassword }` → revokes all refresh tokens except the current session's.
- `POST /auth/2fa/disable` `{ code }` (TOTP or backup code).
- `GET /auth/me` adds `is2faEnabled`, `createdAt`, `customStatus`, profile fields (section 9).
- Rate limits (Redis, `@fastify/rate-limit`): login 10/min/IP and 5/min/account, register 5/hour/IP, 2FA verify 5/5min/challenge, message create 5/5s/user/channel, typing per section 2, invite lookup 30/min/IP.

---

## 9. Profiles

Discord parity with no paid tiers: every Nitro-gated customization is available to everyone.
Shop cosmetics (avatar decorations, nameplates, profile effects, profile frames), connections,
server tags and profile widgets are **UI placeholders** ("Coming soon") with no backend yet.

### Global profile (`transmitters`)
| Field | Rule |
| --- | --- |
| `username` | 2-32 chars, `[a-z0-9_.]`, no `..`, must not start or end with `.`; unique together with `discriminator` (4 digits). Changing it re-rolls the discriminator (existing behavior). Enforced on register and profile update. |
| `display_name` | 1-32 chars, any Unicode, trimmed; empty → falls back to username |
| `pronouns` | text <= 40, nullable |
| `avatar_url` | completed media URL (png/jpeg/gif/webp, animated allowed, <= 8 MB) or null |
| `banner_url` | completed media URL (min 680x240 recommended, <= 10 MB, animated allowed) or null |
| `banner_color` | `#RRGGBB` (used when no banner image) |
| `theme_primary`, `theme_accent` | `#RRGGBB` or null (profile card gradient) |
| `bio` | markdown, <= 190 chars |
| `display_name_style` | jsonb `{ font: 'default' | 'orbitron' | 'rajdhani' | 'space_grotesk' | 'jetbrains' | ..., effect: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop', colors: string[1-2] }` (replaces `display_font` / `display_color`, which stay as read-only mirrors for old clients) |
| `custom_status` | jsonb `{ text <= 128, emoji?: EmojiKey, expiresAt?: ISO }` — clear-after presets: 30m, 1h, 4h, today, never |
| `profile_visibility` | `everyone | beacons | friends` (who can open the full profile; never affects DMs or requests) |

- `PATCH /users/@me/profile` accepts any subset of the above (replaces `PATCH /auth/me/profile`, which stays as an alias). Every field is validated server-side (hex colors by regex, media URLs by ownership, enums by list).
- Event `USER_UPDATE` (public profile fields only) → presence peers; the full self profile → the user.

### Per-beacon profile (`beacon_members`)
Columns: `nickname (1-32)`, `avatar_url`, `banner_url`, `bio (<=190)`, `pronouns (<=40)`, `theme_primary`, `theme_accent`, `display_name_style`.
Each field independently overrides the global one; `null` means "use global".
- `PATCH /beacons/:id/members/@me` `{ nickname?, avatarUrl?, bannerUrl?, bio?, pronouns?, themePrimary?, themeAccent?, displayNameStyle? }` (`CHANGE_NICKNAME` for nickname; others always allowed).
- Name resolution everywhere: beacon nickname → display name → username. Name color: highest colored hoisted-or-not clearance, else the style colors. If the beacon has `suppressCustomFonts`, the font is forced to default inside it.

### Private notes
Table `transmitter_notes(owner_id, target_id, note <= 256, updated_at)` PK `(owner_id, target_id)`.
`GET /users/:id/note`, `PUT /users/:id/note { note }` (empty string deletes).

### Profile read
`GET /users/:id/profile?beaconId=` → honours `profile_visibility` (404 when not allowed) and blocks, returns:
```ts
{ user: { id, username, discriminator, displayName, pronouns, avatarUrl, bannerUrl, bannerColor,
          themePrimary, themeAccent, bio, displayNameStyle, customStatus, presence, createdAt, staffRank },
  member?: { nickname, avatarUrl, bannerUrl, bio, pronouns, themePrimary, themeAccent, displayNameStyle,
             joinedAt, clearances: [{ id, name, color }] },       // when beaconId given and both are members
  commendations: [{ code, name, iconUrl, description }],           // visible ones, in display order
  mutualBeacons: [{ id, name, iconUrl, nickname? }],
  mutualFriends: [author shape],
  relationship: 'self' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none',
  note: string | null }
```

### Surfaces (client)
- Author line: resolved avatar + name (font only; effect on hover), clearance color, staff badge, timestamp.
- Member list row: avatar + presence dot, resolved name, custom status text; grouped by hoisted clearances, then Online, then Offline.
- Popout: banner/theme, avatar + presence, names + pronouns, badges, custom status, bio, member-since (+ beacon member-since), clearances (in a beacon), note, "Message @name" box, "View full profile".
- Full profile modal: everything above plus tabs: About, Mutual Beacons, Mutual Friends; actions: message, add/remove friend, block, report, copy ID.

## 10. Tests required for every item

For each route: happy path, `401` without token, `404/403` for a non-member / outsider (IDOR),
validation failures (`400`), hierarchy/permission denial where applicable, and the published
gateway event type + exact audience (via a Redis subscriber, see `tests/e2e/gateway-messages.test.ts`).

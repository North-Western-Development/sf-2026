# Gateway events

Events arrive on the [gateway](/developers/gateway) as `DISPATCH` (op 0) with the event name in `t`:

```json
{ "op": 0, "t": "REACTION_ADD", "d": { "channelType": "relay", "channelId": "…", "transmissionId": "…", "emoji": "👍", "userId": "…", "type": "REACTION_ADD" } }
```

There are no subscriptions to set up. The server works out who should see each event, and a bot is in that audience because it is a member of the beacon (server) with the [permissions](/developers/bots#permissions) its clearances give it. For example, a transmission (message) in a relay (channel) goes to everyone who can view that relay. A bot gets an event exactly when a person with the same access would.

Notes that apply to every event:

- Events from the API carry the event name again in `d.type`. The exception is `INTERACTION_CREATE`, whose `d.type` is the interaction type, `2`.
- Field names are as the code sends them. Most are camelCase; the gateway's own presence and voice events use snake_case.
- Without the [Message Content intent](/developers/bots#privileged-intents), any event whose `d.transmission` is an object has that transmission's `content`, `embeds`, `attachments`, `stickers` and `poll` emptied, unless it mentions the bot or the bot wrote it.
- Ignore events and fields you don't know: new ones are added.

## Transmissions (messages)

### TRANSMISSION_CREATE

A new transmission in a relay or thread the bot can see. Also sent for webhook posts, bot and interaction replies, and system messages (pins, thread starts, calls).

```json
{ "channelType": "relay", "channelId": "…", "transmission": { … }, "nonce": "optional, echoed from the sender" }
```

`transmission` is the [transmission object](#the-transmission-object).

::: info Legacy and gallery routes
Two older routes still announce new transmissions in a different shape: `{ relay_id, beacon_id, transmission }`, where `transmission` is the stored row (`transmitterId`, `isEdited`, `createdAt`, …) with an `author` object added. They are the legacy relay route and Visual Relays (galleries). Check for `channelType` and fall back to `relay_id`.
:::

### TRANSMISSION_UPDATE

A transmission changed. Two shapes, depending on what changed:

| Change | `d` |
| --- | --- |
| Edited text (`PATCH /transmissions/<id>`) | `{ relay_id, transmission }`, with the **stored row**: `id`, `relayId`, `threadId`, `transmitterId`, `content`, `isEdited`, `mentions`, `embeds`, `createdAt`, `updatedAt`, … (no `author` object) |
| Pinned or unpinned, published to followers, or an interaction reply edited | `{ channelType, channelId, transmission }`, with the [transmission object](#the-transmission-object) |

### TRANSMISSION_DELETE

```json
{ "relay_id": "…", "transmissionId": "…" }
```

`relay_id` is `null` for a transmission outside a relay.

### TRANSMISSION_EMBEDS_UPDATE

Link previews were fetched (or removed) for a transmission.

```json
{ "channelType": "relay", "channelId": "…", "transmissionId": "…", "embeds": [ … ] }
```

### CHANNEL_PINS_UPDATE

```json
{ "channelType": "relay", "channelId": "…", "lastPinAt": "2026-10-28T12:00:00.000Z" }
```

### TYPING_START

```json
{ "channelType": "relay", "channelId": "…", "userId": "…", "displayName": "Sam", "timestamp": 1792000000000 }
```

At most one per person per channel every 5 seconds.

### The transmission object

| Field | Notes |
| --- | --- |
| `id` | Snowflake |
| `channelType`, `channelId` | Where it is: `relay`, `thread`, `link` or `mesh` |
| `relayId`, `threadId`, `p2pLinkId`, `meshId` | The container's id (the others are `null`) |
| `author` | `{ id, username, discriminator, displayName, avatarUrl, displayColor, displayFont, staffRank, tagBeaconId, avatarDecoration, botKind, botVerified }`. `botKind` is `bot`, `webhook` or `null`. |
| `member` | In beacons: `{ nickname, clearanceIds, color }` |
| `content` | The text |
| `createdAt`, `editedAt` | ISO 8601 |
| `type` | `default`, `reply`, or a system type (pins, thread starts, calls) |
| `mentions`, `mentionRoles`, `mentionEveryone` | User ids, clearance ids, and whether `@everyone`/`@here` was used |
| `replyTo` | `{ id, author, content (first 200 characters), attachmentsCount, deleted }` or `null` |
| `attachments`, `stickers`, `poll`, `voiceMessage`, `embeds` | Content |
| `reactions` | `[{ emoji, count, me, glyph? }]` |
| `pinned` | Boolean |
| `webhookId` | Set on webhook posts |
| `interaction` | `{ name, user }` on a reply to a slash command, otherwise `null` |
| `publishedAt`, `crosspost` | [Announcements](/developers/webhooks#announcement-relays): when it was published, and on a copy, where it came from |
| `forwarded`, `encrypted`, `suppressEmbeds` | Forwarded content, end-to-end encryption, hidden previews |

## Reactions and polls

| Event | `d` |
| --- | --- |
| `REACTION_ADD` | `{ channelType, channelId, transmissionId, emoji, userId }` |
| `REACTION_REMOVE` | The same, when someone takes theirs back or a moderator removes it |
| `POLL_UPDATE` | `{ channelType, channelId, transmissionId, counts, totalVoters, ended }` |

## Interactions

### INTERACTION_CREATE

Someone used one of the bot's [slash commands](/developers/commands). Sent only to that bot, and only when it has no Interactions Endpoint URL (otherwise the interaction is an HTTP request).

```json
{
  "type": 2,
  "id": "…",
  "token": "…",
  "applicationId": "…",
  "beaconId": "…",
  "channel": { "type": "relay", "id": "…" },
  "user": { "id": "…", "username": "sam", "displayName": "Sam", "avatarUrl": null },
  "memberPermissions": "2251799813686787",
  "data": {
    "id": "…",
    "name": "roll",
    "options": [{ "name": "sides", "type": "integer", "value": 20 }]
  }
}
```

| Field | Notes |
| --- | --- |
| `id`, `token` | Answer with `POST /api/v1/interactions/<id>/<token>/callback` within 3 seconds. The token works for 15 minutes. |
| `channel` | `relay` or `thread`, and its id |
| `memberPermissions` | The user's permissions in the beacon, as a decimal string |
| `data.options` | The options they filled in, already checked against your definitions. `user`, `relay` and `clearance` values are ids in that beacon; `integer` and `number` are numbers; `boolean` is a boolean. |

## Relays and threads

| Event | `d` |
| --- | --- |
| `RELAY_CREATE` | `{ beaconId, relay }` |
| `RELAY_UPDATE` | `{ beaconId, relay }`: also sent when permission overwrites change, to those who could see it before or can now |
| `RELAY_DELETE` | `{ beaconId, relayId }` |
| `THREAD_CREATE`, `THREAD_UPDATE` | `{ relayId, thread }`. A thread in a text relay is `{ id, relayId, title, creatorId, starterTransmissionId, isLocked, isPrivate, messageCount, lastTransmissionAt, createdAt }`; a post in an Archival Relay (forum) is its stored row. |
| `THREAD_DELETE` | `{ relayId, threadId }`, to someone removed from a private thread |

## Beacons, members and clearances

| Event | `d` |
| --- | --- |
| `BEACON_CREATE` | `{ beacon }`: sent to the bot when it is added to a beacon |
| `BEACON_UPDATE` | `{ beacon }` |
| `BEACON_DELETE` | `{ id, unavailable: false }` |
| `MEMBER_ADD` | `{ beaconId, member }` |
| `MEMBER_UPDATE` | `{ beaconId, member }`: nickname, clearances, timeout, server mute, … |
| `MEMBER_REMOVE` | `{ beaconId, transmitterId }`: left, kicked or banned |
| `CLEARANCE_CREATE`, `CLEARANCE_UPDATE` | `{ beaconId, clearance }`, with `permissions` as a decimal string |
| `CLEARANCE_DELETE` | `{ beaconId, clearanceId }` |
| `GLYPHS_UPDATE` | `{ beaconId }`: custom emoji changed; fetch them again |
| `BEACON_EXPRESSIONS_UPDATE` | `{ beaconId, kind: "stickers" \| "sounds" }` |
| `ONBOARDING_UPDATE` | `{ beaconId }` |
| `EVENT_UPSERT`, `EVENT_DELETE` | `{ beaconId, event }`, `{ beaconId, eventId }`: scheduled events |

A `member` is:

| Field | Notes |
| --- | --- |
| `transmitterId` | The member's id |
| `user` | `{ id, username, discriminator, displayName, avatarUrl, displayColor, displayFont, displayNameStyle, staffRank, tagBeaconId, avatarDecoration, botKind, botVerified }` |
| `nickname`, `clearanceIds`, `joinedAt`, `isOwner` | Membership |
| `timeoutUntil`, `serverMuted`, `serverDeafened` | Moderation state |
| `presence`, `customStatus` | Status |
| `username`, `discriminator`, `displayName`, `avatarUrl`, `bannerUrl`, `bannerColor`, `bio`, `displayColor`, `displayFont`, `member`, `hasCompletedOnboarding` | Profile (`member` holds per-beacon overrides: `{ avatarUrl, bannerUrl, bio, pronouns }`) |

When the bot itself is removed from a beacon, it gets no `MEMBER_REMOVE` or `BEACON_DELETE`: it gets a [`RELATIONSHIPS_REFRESH`](#connection), and `GET /bots/@me` no longer lists the beacon.

## Voice and presence

These come from the gateway itself, in snake_case.

| Event | `d` |
| --- | --- |
| `PRESENCE_UPDATE` | `{ transmitter_id, presence, timestamp }`. A custom-status change sends `{ transmitter_id, presence, custom_status }`. `invisible` shows as `offline`. |
| `USER_ACTIVITY_UPDATE` | `{ transmitter_id, activity }` (`null` when they stop). Only with the Activity Status intent, and as each person's Activity Privacy allows. |
| `VOICE_STATE_UPDATE` | `{ transmitter_id, username, relay_id, beacon_id, call_type, call_id, is_muted, is_deafened, is_speaking, is_clipping, is_priority, timestamp }`. When someone leaves, `relay_id`, `call_id` and `call_type` are `null`. |
| `USER_UPDATE` | `{ user }`: someone you share a beacon with changed their profile |
| `STAGE_UPDATE` | `{ relayId, beaconId, stage: { topic, startedAt, startedBy, speakers, requests, invites } }` |

Presence covers everyone the bot shares a beacon with. `activity` follows [the activity format](/developers/rich-presence/#the-activity), with `name`, `applicationId` and `source` set by Subspace.

## Connection

| Event | `d` |
| --- | --- |
| `READY` | See [READY](/developers/gateway#ready) |
| `PRESENCE_CONFIRMATION` | `{ presence }`, after you send op 3 |
| `RELATIONSHIPS_REFRESH` | `{ presences, voice_states, activities }`: who you can see changed (the bot was added to or removed from a beacon, its intents changed, …). Replace your snapshots with these. |
| `SESSION_REVOKED` | `{}`, just before the connection closes with `4005` |

## Not for bots

Some events go only to people, so a bot never receives them: Direct Link (DM) and Mesh (group DM) events (`DIRECT_TRANSMISSION_CREATE`, `MESH_*`), calls (`CALL_*`), affiliations (`RELATIONSHIP_*`), end-to-end encryption signals, read states, notification settings, bookmarks and reminders, the soundboard, and the interaction status events shown to the person who used a command (`INTERACTION_DEFERRED`, `INTERACTION_FAILED`, `INTERACTION_EPHEMERAL`).

# Bots

A bot is an account that belongs to a [Developer Application](/developers/). It joins beacons (servers) when someone adds it, reads and sends transmissions (messages) over the [REST API](/developers/rest), receives [gateway events](/developers/events), and answers [slash commands](/developers/commands).

## Create a bot

1. **User Settings › Developer Applications**, open your application, **Add Bot**.
2. Copy the **bot token**. It is shown **once**. **Reset Token** makes a new one; the old one stops working for REST calls at once.
3. Note the **Public Key** under the bot: it checks the signature on [HTTP interactions](/developers/commands#over-http-instead-of-the-gateway).

The bot's display name and picture are the application's; its username is made from the name and the end of its id (`dice_bot_482913`). Its account carries the **APP** tag.

A token looks like `<base64url of the bot's user id>.<secret>`. Send it as:

```http
Authorization: Bot <token>
```

Treat it like a password: anyone holding it controls the bot. Keep it out of source control and reset it if it leaks.

Over the API (with a person's session, as the application's owner or a team member with the role shown):

| Endpoint | Role | Does |
| --- | --- | --- |
| `GET /api/v1/applications/<id>/bot` | Read-only | The bot's settings (never its token) |
| `POST /api/v1/applications/<id>/bot` | Developer | Creates it. `201 { bot: { …, token } }`: the only time the token is shown. `409 BOT_EXISTS` if there is one. |
| `PATCH /api/v1/applications/<id>/bot` | Developer | `{ isPublic?, messageContent?, activityIntent?, interactionsUrl? }` |
| `POST /api/v1/applications/<id>/bot/reset-token` | Developer | `{ bot: { …, token } }` with a new token |
| `DELETE /api/v1/applications/<id>/bot` | Admin | Deletes the bot: it leaves every beacon and its token stops working |

The bot object is `{ userId, isPublic, messageContent, activityIntent, interactionsUrl, publicKey }` (plus `token` when one was just made). `publicKey` is the 32-byte Ed25519 public key in hex.

## Who can add it

**Public Bot** (`isPublic`) decides who may add it to a beacon:

- **On**: anyone with *Manage Beacon* in a beacon, through the invite link. Its profile card shows **Add App**.
- **Off** (the default): only its developers, meaning its owner and members of its team with the Developer role or above. Anyone else gets `403 PRIVATE_BOT`, and nobody else sees **Add App**.

## Privileged intents

Two kinds of data are off for a bot until its developer turns them on. There is no `intents` field to send: they are switches on the bot (**Developer Applications**, or `PATCH …/bot`), and a connected bot gets or loses them straight away.

| Intent | Field | Without it | With it |
| --- | --- | --- | --- |
| **Message Content** | `messageContent` | In gateway events, a transmission's `content`, `embeds`, `attachments`, `stickers` and `poll` are emptied, except in transmissions that mention the bot and its own. | Full transmissions. |
| **Activity Status** | `activityIntent` | No `USER_ACTIVITY_UPDATE` events, and an empty `activities` list in `READY`. | What members are playing, as each one's Activity Privacy allows. |

An instance can keep either intent for verified developers (see [Developer policy](/developers/#developer-policy)); turning one on is then refused with `403 INTENT_RESTRICTED`. Presence (online, idle, …) and typing are not behind an intent.

::: tip
Message Content redaction applies to gateway events. It does not change what the REST API returns: `GET /channels/relay/<id>/transmissions` answers with whatever the bot's clearances let it read.
:::

## Add it to a beacon

The **Invite Link** under the bot is:

```
https://subspace.click/oauth2/authorize?client_id=<application id>&scope=bot&permissions=<bits>
```

Opening it shows the **Add to beacon** screen: pick a beacon where you have *Manage Beacon*, untick any permission you don't want to give, and **Authorize**. `permissions` is a [permission bitfield](#permissions) written as a decimal string. The link **Developer Applications** gives you asks for `532487`: View Relays, Send Transmissions, Embed Links, Add Reactions and Read History.

`scope=bot` must be the only scope: Sign in with Subspace is a separate flow ([OAuth2](/developers/oauth2)).

What happens when it is added:

- The bot becomes a member and gets a clearance (role) of its own, named after the application, holding the permissions granted. The clearance is managed: it goes when the bot leaves.
- No one can give a bot permissions they don't hold themselves, unless they own the beacon or hold *Administrator* (`403 FORBIDDEN_PERMISSION_GRANT`).
- The beacon sees `CLEARANCE_CREATE` and `MEMBER_ADD`; the bot's own connection gets `BEACON_CREATE` for that beacon and a `RELATIONSHIPS_REFRESH`.

The same over the API, with a person's session:

| Endpoint | Needs | Does |
| --- | --- | --- |
| `GET /api/v1/beacons/<id>/bots` | Membership | The bots in a beacon |
| `POST /api/v1/beacons/<id>/bots` | *Manage Beacon* | `{ appId, permissions? }`: answers `201 { added, userId, clearanceId }`. `409 BOT_ALREADY_MEMBER` if it is there. |
| `DELETE /api/v1/beacons/<id>/bots/<appId>` | *Manage Beacon* or *Kick Members* | Removes it, with its clearance |

Removing it also works from **Beacon Settings › Integrations › Remove**, or by kicking it.

## What a bot can do

A bot calls the [REST API](/developers/rest) with its token. It can use the routes made for bots, listed under [What bots can call](/developers/rest#what-bots-can-call): reading the beacons it is in, transmissions, reactions, pins, polls, threads, members, clearances, moderation its permissions allow, its own commands and interaction replies. Every other route answers `403 BOT_FORBIDDEN`.

A bot cannot sign in on the web, join a Comm-Link (voice channel) (its voice-state updates are ignored), open Direct Links (DMs) or Meshes (group DMs), use slash commands, or add other bots.

`GET /api/v1/bots/@me` answers who the bot is and where:

```json
{ "bot": { "id": "…", "username": "dice_bot_482913", "displayName": "Dice Bot", "avatarUrl": null, "appId": "…", "beaconIds": ["…"] } }
```

`READY` on the gateway does not list beacons, so call this after connecting.

## Permissions

Clearances (roles) carry a 64-bit permission bitfield, sent as a decimal string. Combine bits with OR: `VIEW_RELAY | SEND_TRANSMISSIONS` is `1 + 2 = "3"`. The ones that matter most to bots are at the top of the list below; the full set is in `packages/constants/src/index.ts` (`PERMISSIONS`).

| Permission | Bit | Value | Allows |
| --- | --- | --- | --- |
| `VIEW_RELAY` | 0 | `1` | See the relay and its transmissions |
| `SEND_TRANSMISSIONS` | 1 | `2` | Post in text and archival relays |
| `EMBED_LINKS` | 2 | `4` | Link previews on its transmissions |
| `ATTACH_FILES` | 3 | `8` | Attach files |
| `MANAGE_TRANSMISSIONS` | 8 | `256` | Delete other people's transmissions |
| `KICK_MEMBERS` | 11 | `2048` | Kick members below its highest clearance |
| `BAN_MEMBERS` | 12 | `4096` | Ban members below its highest clearance |
| `ADD_REACTIONS` | 13 | `8192` | Add new reactions (adding to an existing one needs only `VIEW_RELAY`) |
| `MENTION_EVERYONE` | 14 | `16384` | `@everyone` and `@here` |
| `MANAGE_BEACON` | 16 | `65536` | Edit the beacon's settings |
| `READ_HISTORY` | 19 | `524288` | Read transmissions sent before it could see the relay |
| `MUTE_MEMBERS` | 21 | `2097152` | Server-mute members in Comm-Links |
| `MOVE_MEMBERS` | 22 | `4194304` | Move or disconnect members in Comm-Links |
| `PIN_TRANSMISSIONS` | 23 | `8388608` | Pin and unpin |
| `MODERATE_MEMBERS` | 26 | `67108864` | Time out members below its highest clearance |
| `ADMINISTRATOR` | 29 | `536870912` | Every permission, everywhere |
| `CREATE_THREADS` | 30 | `1073741824` | Start public threads |
| `DEAFEN_MEMBERS` | 33 | `8589934592` | Server-deafen members in Comm-Links |
| `CREATE_PRIVATE_THREADS` | 37 | `137438953472` | Start invite-only threads |
| `SEND_IN_THREADS` | 38 | `274877906944` | Post in threads |
| `MANAGE_THREADS` | 39 | `549755813888` | Rename, lock or delete any thread; see every private thread |
| `BYPASS_SLOWMODE` | 40 | `1099511627776` | Not held back by slowmode |
| `MENTION_CLEARANCES` | 41 | `2199023255552` | Mention clearances that are not mentionable by everyone |
| `CREATE_POLLS` | 45 | `35184372088832` | Post polls |
| `MANAGE_WEBHOOKS` | 50 | `1125899906842624` | Create, edit and delete webhooks |
| `USE_APPLICATION_COMMANDS` | 51 | `2251799813685248` | Use bots' slash commands (for members, not bots) |

Other bits: `USE_SIGNAL_GLYPHS` 4, `CONNECT_AUDIO` 5, `SPEAK_AUDIO` 6, `BROADCAST_HOLO_CAST` 7, `MANAGE_RELAYS` 9, `MANAGE_CLEARANCES` 10, `CREATE_INVITES` 15, `CHANGE_NICKNAME` 17, `MANAGE_NICKNAMES` 18, `MANAGE_GLYPHS` 20, `CREATE_EVENTS` 24, `MANAGE_EVENTS` 25, `VIEW_AUDIT_LOG` 27, `USE_SOUNDBOARD` 28, `USE_ACTIVITIES` 31, `SHARE_SCREEN` 32, `CREATE_RELAYS` 34, `MANAGE_INVITES` 35, `CREATE_EXPRESSIONS` 36, `USE_EXTERNAL_GLYPHS` 42, `USE_EXTERNAL_STICKERS` 43, `SEND_VOICE_MESSAGES` 44, `USE_VOICE_ACTIVITY` 46, `PRIORITY_SPEAKER` 47, `REQUEST_TO_SPEAK` 48, `VIEW_INSIGHTS` 49. The value of bit *n* is 2<sup>*n*</sup>.

Relay permission overwrites apply to bots as to anyone: a bot sees a relay only where its clearances, after overwrites, allow `VIEW_RELAY`.

## Next

- [Gateway](/developers/gateway): connect and receive events.
- [Slash commands](/developers/commands): register commands and answer interactions.
- [SDKs](/developers/sdk/javascript): skip the plumbing.

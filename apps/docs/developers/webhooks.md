# Webhooks and announcement relays

## Webhooks

A webhook posts into one relay (channel) from a secret URL. There is nothing to host and no account to run: point CI, monitoring or a feed at it.

**Beacon Settings › Integrations › New Webhook** makes one. You need **Manage Webhooks** in its relay. The URL is shown only when the webhook is made or reset. Anyone with it can post, so keep it secret, and use **Reset URL** if it leaks.

### Posting

```bash
curl -X POST "https://subspace.click/api/v1/webhooks/<id>/<token>" \
  -H "content-type: application/json" \
  -d '{"content": "Deploy finished", "username": "CI", "embeds": [{"title": "Build #42", "color": "#43B581", "fields": [{"name": "Branch", "value": "main", "inline": true}]}]}'
```

| Field | Notes |
| --- | --- |
| `content` | Up to 2000 characters. Mentions of people (`<@id>`) work, and of clearances (`<@&id>`) when they are mentionable. `@everyone` and `@here` never ping. |
| `username` | Up to 80 characters: this post's name instead of the webhook's |
| `avatarUrl` | An `http(s)` image URL: this post's picture instead of the webhook's |
| `embeds` | Up to 10 [embeds](/developers/embeds) |

Send `content` or at least one embed (`400 EMPTY_MESSAGE`). The answer is `200 { transmission }`. A wrong id or token is `404 UNKNOWN_WEBHOOK` either way.

Each webhook can post **5 times every 2 seconds**, and each address **30 times a minute** (`429`). Posts carry the **HOOK** tag, and appear in events like any transmission (`TRANSMISSION_CREATE`, with `webhookId` set).

### Managing webhooks

All of these need *Manage Webhooks* in the webhook's relay, with a person's session.

| Route | Does |
| --- | --- |
| `GET /api/v1/relays/<relayId>/webhooks` | The relay's webhooks |
| `GET /api/v1/beacons/<beaconId>/webhooks` | The beacon's, in relays where you may manage them |
| `POST /api/v1/relays/<relayId>/webhooks` | `{ name (1 to 80), avatarUrl? }`. `201 { webhook }` with its `token` and `url`, the only time they are shown. A beacon can have 50 webhooks (`400 WEBHOOK_LIMIT`). |
| `PATCH /api/v1/webhooks/<id>` | `{ name?, avatarUrl?, relayId? }`. Moving it needs *Manage Webhooks* in the new relay too, in the same beacon. |
| `POST /api/v1/webhooks/<id>/reset-token` | A new token and URL; the old URL stops working |
| `DELETE /api/v1/webhooks/<id>` | Deletes it. Its transmissions stay, under the name it had. |

Webhooks can post in text, archival (forum) and visual (gallery) relays. A webhook object is `{ id, beaconId, relayId, name, avatarUrl, creatorId, sourceRelayId, createdAt }`, plus `token` and `url` when just made or reset.

## Announcement relays

A text relay can be an **announcement relay** (Discord's announcement channel): **Create Relay › Announcement Relay**, or the switch in its settings. Other beacons can **Follow** it, and what it publishes is copied into a relay of theirs.

### Publishing

Right-click a transmission in an announcement relay and choose **Publish**: your own (if you can post there), or anyone's with *Manage Transmissions*.

```http
POST /api/v1/channels/relay/<relayId>/transmissions/<transmissionId>/publish
```

The answer is `{ transmission, delivered }`, where `delivered` counts the relays that got a copy. The original gets `publishedAt` (a `TRANSMISSION_UPDATE` tells everyone), and can be published only once (`409 ALREADY_PUBLISHED`).

- A relay publishes at most **10 times an hour** (`429 RATE_LIMITED`).
- Ordinary transmissions and replies can be published; polls, encrypted transmissions and system messages can't (`400 NOT_PUBLISHABLE`).
- Bots can't publish or follow.

### Following

**Follow** in an announcement relay's header picks a text relay of yours where you have *Manage Webhooks*.

```http
POST /api/v1/relays/<announcementRelayId>/followers
{ "targetRelayId": "<your text relay>" }
```

Following makes a **follower webhook** in your relay: a webhook whose `sourceRelayId` is the announcement relay. It has no URL anyone can post to (resetting it is refused with `400 FOLLOWER_WEBHOOK`); it only carries what the announcement relay publishes. It counts toward your beacon's 50 webhooks, and a relay can follow a given announcement relay once (`409 ALREADY_FOLLOWING`).

Each copy:

- is signed with the source beacon's name and relay (`Beacon #relay`) and the beacon's icon, and carries the **BEACON** tag;
- has the original's text, rich embeds and attachments, and a `crosspost` field: `{ beaconId, beaconName, relayId, relayName, transmissionId }`;
- never pings anyone in the beacons that follow.

A follow shows in **Beacon Settings › Integrations** with the other webhooks. **Unfollow** there, or `DELETE /api/v1/webhooks/<id>`, ends it.

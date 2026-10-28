# Slash commands and interactions

Slash commands are commands a [bot](/developers/bots) registers. Members pick them from the `/` menu in the message box, and each use reaches the bot as an **interaction**, which it answers with a reply.

## Registering commands

Register as the bot (`Authorization: Bot <token>`), or as the application's owner with their own session.

| Route | Scope |
| --- | --- |
| `GET` / `PUT /api/v1/applications/<appId>/commands` | Global: in every beacon (server) the bot is in |
| `GET` / `PUT /api/v1/applications/<appId>/beacons/<beaconId>/commands` | One beacon only. The bot must be in it (`403 BOT_NOT_MEMBER`). |

`PUT` takes the **whole list** (up to 100 commands) and replaces what was there: commands left out are deleted. A command keeps its id as long as its name stays the same. The answer is `{ commands: [...] }`, each with its `id`, `appId`, `beaconId` (`null` for global), `name`, `description`, `options` and `defaultMemberPermissions`.

```json
[
  {
    "name": "remind",
    "description": "Set a reminder",
    "options": [
      { "type": "user", "name": "who", "description": "Who to remind", "required": true },
      { "type": "integer", "name": "minutes", "description": "In how long" },
      { "type": "string", "name": "unit", "description": "Unit", "choices": [{ "name": "Minutes", "value": "m" }, { "name": "Hours", "value": "h" }] }
    ],
    "defaultMemberPermissions": "8192"
  }
]
```

| Field | Rules |
| --- | --- |
| `name` | Lowercase letters, digits, `-` and `_`, 1 to 32 characters. Unique in the list (`400 INVALID_COMMANDS`). |
| `description` | 1 to 100 characters |
| `options` | Up to 25. Each has `type`, `name` (same rules as a command name), `description` (1 to 100), and optionally `required` and `choices`. |
| `options[].type` | `string`, `integer`, `number`, `boolean`, `user`, `relay` or `clearance` |
| `options[].choices` | Up to 25 `{ name (≤100), value }`, where `value` is a string or a number. The value given must be one of them. |
| `defaultMemberPermissions` | A [permission bitfield](/developers/bots#permissions) as a decimal string. Only members holding all of those bits see and can use the command. `null` or absent: everyone. |

## Who can use them

A member sees a bot's commands in a relay (channel) when:

- the bot is in the beacon;
- they hold **Use Application Commands** (`USE_APPLICATION_COMMANDS`) there, and the command's `defaultMemberPermissions`;
- the bot can view and post in that relay (otherwise using it answers "*Bot* cannot post here").

Commands work in relays and threads, not in Direct Links. Bots can't use commands.

In the message box, members type `/remind who:@sam minutes:10`. A command with one option takes the whole text after its name.

## Receiving interactions

Each use becomes an interaction, delivered one of two ways:

- **Over the gateway** (the default): an [`INTERACTION_CREATE`](/developers/events#interaction-create) event on the bot's connection. If the bot isn't connected, the interaction is lost.
- **Over HTTP**: when the bot has an **Interactions Endpoint URL**, a signed `POST` to that URL instead (see [below](#over-http-instead-of-the-gateway)).

The interaction:

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
  "data": { "id": "<command id>", "name": "remind", "options": [{ "name": "who", "type": "user", "value": "…" }, { "name": "minutes", "type": "integer", "value": 10 }] }
}
```

Options come checked: required ones are present, numbers are numbers (`integer` ones whole), `boolean` is `true` or `false`, a `string` is at most 6000 characters, and `user`, `relay` and `clearance` values are ids that exist in that beacon. Options the person left empty are not listed.

## Answering

Answer every interaction within **3 seconds**, or the person sees "*Bot* did not respond".

```http
POST /api/v1/interactions/<id>/<token>/callback
```

| Body | Effect |
| --- | --- |
| `{ "type": 4, "data": { "content": "…", "embeds": [...], "ephemeral": true } }` | Reply now. |
| `{ "type": 5, "data": { "ephemeral": false } }` | Defer: they see "*Bot* is thinking…". Send the reply within 15 minutes as a follow-up. |

`data` is a **reply**: `content` (up to 2000 characters), `embeds` (up to 10 [embeds](/developers/embeds)), `ephemeral`. A reply needs content or an embed.

- An **ephemeral** reply is shown only to the person who used the command, and is never stored. It can't be edited.
- Anything else is a transmission (message) from the bot in that channel, marked with the command and who used it.

The token in the URL is the credential: these calls need no `Authorization` header. It works for 15 minutes.

| Route | Does |
| --- | --- |
| `POST /api/v1/interactions/<id>/<token>/callback` | The first answer. `204` when accepted. |
| `POST /api/v1/interactions/<id>/<token>/followup` | Another reply (a reply body). After a defer, the first follow-up is the reply itself, and is ephemeral if the defer was. `{ transmission }` |
| `PATCH /api/v1/interactions/<id>/<token>/original` | Edit the reply (`content` and/or `embeds`). After a defer with no reply yet, this sends it. `{ transmission }` |

| Error | Means |
| --- | --- |
| `404 UNKNOWN_INTERACTION` | Wrong id or token, or more than 15 minutes old |
| `400 ALREADY_RESPONDED` | The callback was already used: send a follow-up |
| `400 RESPONSE_TOO_LATE` | More than 3 seconds passed: defer next time |
| `400 NOT_RESPONDED` | A follow-up before the callback |
| `400 EPHEMERAL` | Ephemeral replies can't be edited |
| `400 EMBED_TOO_LARGE` | Embeds over 6000 characters in all |

With an SDK, call `reply()`, `defer()`, `followUp()` or `editReply()` on the interaction.

## Over HTTP instead of the gateway

Set the bot's **Interactions Endpoint URL** (**Developer Applications**, or `PATCH /api/v1/applications/<id>/bot` with `interactionsUrl`) to receive interactions as HTTP requests, so the bot doesn't have to stay connected. The URL must be public `https://` (`http://` is allowed only on instances not running in production) and must not resolve to a private address (`400 INVALID_INTERACTIONS_URL`). Set it to `null` to go back to the gateway.

Each interaction is a `POST` with the interaction as its JSON body and these headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Signature-Ed25519` | The signature, 64 bytes as hex |
| `X-Signature-Timestamp` | Unix time in seconds, as a decimal string |
| `User-Agent` | `SubspaceBot/1.0 (+https://subspace.click)` |

Answer **in the response body**, within 3 seconds, with the same `{ "type": 4, … }` or `{ "type": 5, … }` object and a `2xx` status. Anything else (another status, no answer in time, a body that isn't one of those) leaves the interaction unanswered, unless you answer it with the callback route in time. There is no PING handshake when you save the URL.

### Verifying the signature

Every request is signed with Ed25519 by the instance, with a key pair made for your bot. Its **Public Key** (32 bytes, hex) is under the bot in **Developer Applications**, and is `publicKey` in the bot object. Check every request before trusting it; reject anything that fails:

1. Read the **raw** request body, as bytes, before parsing it. Re-serialized JSON will not verify.
2. Take `timestamp` = `X-Signature-Timestamp` and `signature` = `X-Signature-Ed25519` (hex-decoded: 64 bytes).
3. The signed message is the UTF-8 bytes of `timestamp` followed immediately by the raw body: `timestamp + body`, with nothing in between.
4. Verify the signature over that message with the public key (hex-decoded: 32 bytes). Reject with `401` if it fails.
5. Reject requests whose timestamp is more than **5 minutes** from your clock, so an old request can't be replayed.

Every SDK has this check ([JavaScript](/developers/sdk/javascript#http-interactions), [Python](/developers/sdk/python#http-interactions), [Java](/developers/sdk/java#http-interactions), [C#](/developers/sdk/csharp#http-interactions), [C++](/developers/sdk/cpp#http-interactions)). In Node, with Express:

```ts
import express from 'express';
import { verifyInteraction, respondWith } from '@subspace/bot-sdk';

const app = express();
app.post('/interactions', express.text({ type: '*/*' }), (req, res) => {
  const ok = verifyInteraction(req.body, req.get('x-signature-ed25519')!, req.get('x-signature-timestamp')!, process.env.PUBLIC_KEY!);
  if (!ok) return res.status(401).end();
  const interaction = JSON.parse(req.body);
  res.json(respondWith(`Hello ${interaction.user.username}`));
});
app.listen(3000);
```

Or by hand, in Python with `cryptography`:

```python
import time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

def verify(raw_body: bytes, signature_hex: str, timestamp: str, public_key_hex: str) -> bool:
    if not timestamp.isascii() or not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    try:
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        key.verify(bytes.fromhex(signature_hex), timestamp.encode() + raw_body)
        return True
    except (ValueError, InvalidSignature):
        return False
```

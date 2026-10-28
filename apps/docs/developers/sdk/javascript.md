# JavaScript and TypeScript bots

`@subspace/bot-sdk` covers the REST API, the gateway, slash commands and interactions (over the gateway or signed HTTP). It is written in TypeScript and ships its types. Source: `packages/bot-sdk`.

| | |
| --- | --- |
| Package | `@subspace/bot-sdk` (ES module) |
| Runs on | Node 18+, Bun, [Deno](/developers/sdk/deno) |
| Depends on | `ws`, loaded only on runtimes without a built-in `WebSocket` (Node 18 and 20) |

## Install

From the [package registry](/developers/registry):

```bash
npm config set @subspace:registry https://subspace.click/packages/npm/
npm install @subspace/bot-sdk
```

## Quick start

Make a bot and copy its token first ([Bots](/developers/bots)).

```ts
import { SubspaceBot } from '@subspace/bot-sdk';

const bot = new SubspaceBot({ token: process.env.BOT_TOKEN!, baseUrl: 'https://subspace.click' });

await bot.registerCommands([
  { name: 'ping', description: 'Check the bot is alive' },
  { name: 'roll', description: 'Roll a die', options: [{ type: 'integer', name: 'sides', description: 'How many sides' }] },
]);

bot.on('interaction', (i) => {
  if (i.commandName === 'ping') return i.reply('Pong!');
  const sides = i.option<number>('sides') ?? 6;
  return i.reply({ embeds: [{ title: `🎲 ${1 + Math.floor(Math.random() * sides)}`, footer: { text: `d${sides}` } }] });
});

bot.on('message', (m) => {
  if (m.content === '!hello') void bot.send('relay', m.channelId, `Hi ${m.author.username}!`);
});

await bot.connect(); // resolves at READY; reconnects on its own after that
```

`bot.on('message')` sees message text only with the [Message Content intent](/developers/bots#privileged-intents), or in messages that mention the bot. A runnable version is `packages/bot-sdk/examples/dice-bot.mjs`.

## API

### `new SubspaceBot(options)`

| Option | |
| --- | --- |
| `token` | The bot token, without `Bot ` |
| `baseUrl` | The instance, such as `https://subspace.click` |
| `gatewayUrl` | Optional. Default: `baseUrl` with `ws(s)://` and `/gateway` |

`SubspaceBot` is an `EventEmitter`.

### Methods

| Method | Calls |
| --- | --- |
| `connect(): Promise<void>` | Opens the gateway; resolves at `READY` |
| `disconnect()` | Closes it and stops reconnecting |
| `me()` | `GET /bots/@me`; also sets `bot.user` |
| `send(channelType, channelId, message)` | `POST /channels/<type>/<id>/transmissions`. `channelType` is `'relay'` or `'thread'`; `message` a string or `{ content?, replyToId? }`. Returns the transmission. |
| `edit(transmissionId, content)` | `PATCH /transmissions/<id>` |
| `delete(transmissionId)` | `DELETE /transmissions/<id>` |
| `react(transmissionId, emoji)` | `PUT /transmissions/<id>/reactions/<emoji>/@me` |
| `registerCommands(commands, beaconId?)` | `PUT /applications/<appId>/commands`, or one beacon's. Returns the registered commands. |
| `rest(method, path, body?)` | Any other [REST](/developers/rest) call, with the bot token. `path` is after `/api/v1`. |

A failed call throws `SubspaceApiError` with `message`, `status` and `code`.

::: warning
`send()` accepts `embeds` in its type, but the server ignores embeds on plain transmissions. Use them in interaction replies.
:::

### Events

| Event | Arguments |
| --- | --- |
| `ready` | The `READY` payload |
| `message` | A new transmission, with `channelType` and `channelId` added |
| `messageUpdate` | The `TRANSMISSION_UPDATE` transmission |
| `messageDelete` | The `TRANSMISSION_DELETE` payload |
| `interaction` | An `Interaction` |
| `dispatch` | `(type, data)` for every event, including those above. See [Gateway events](/developers/events). |
| `close` | `(code, reason)` |
| `error` | An `Error` (emitted only when you listen for it) |

### Interaction

| Member | |
| --- | --- |
| `id`, `commandName`, `user`, `channel`, `beaconId`, `raw` | From the [interaction](/developers/commands#receiving-interactions) |
| `option<T>(name)` | An option's value, or `undefined` |
| `reply(reply)` | Answer now: a string, or `{ content?, embeds?, ephemeral? }` |
| `defer({ ephemeral? })` | "Thinking…"; reply later with `followUp` or `editReply` |
| `followUp(reply)` | Another reply (the first one after `defer` is the reply) |
| `editReply(reply)` | Edit the reply |

Each returns a promise. Answer within 3 seconds, or `defer()`.

## HTTP interactions

With an **Interactions Endpoint URL**, check each request and answer in the response:

```ts
import express from 'express';
import { verifyInteraction, respondWith, deferWith } from '@subspace/bot-sdk';

const app = express();
app.post('/interactions', express.text({ type: '*/*' }), (req, res) => {
  if (!verifyInteraction(req.body, req.get('x-signature-ed25519')!, req.get('x-signature-timestamp')!, process.env.PUBLIC_KEY!)) {
    return res.status(401).end();
  }
  const interaction = JSON.parse(req.body);
  res.json(respondWith(`Hello ${interaction.user.username}`));
});
app.listen(3000);
```

| Function | |
| --- | --- |
| `verifyInteraction(rawBody, signature, timestamp, publicKeyHex): boolean` | Synchronous, with `node:crypto` (Node, Deno, Bun). Rejects timestamps more than 5 minutes off. |
| `verifyInteractionAsync(…): Promise<boolean>` | The same with WebCrypto, for runtimes such as Cloudflare Workers (needs Ed25519 in WebCrypto) |
| `respondWith(reply)` | `{ type: 4, data }` |
| `deferWith({ ephemeral? })` | `{ type: 5, data }` |

Pass the **raw** body string, not re-serialized JSON.

## Async model

- Everything runs on the event loop. Event handlers are called in order and not awaited: an `async` handler runs alongside the next event, and a rejection in it is yours to catch.
- The SDK sends heartbeats on a timer.
- After a disconnect it reconnects after 2 seconds and identifies again, except after close code `4003` (bad token), which rejects `connect()`. There is no resume: events during the gap are lost.
- If the gateway can't be reached at all, `connect()` keeps retrying and doesn't settle until it connects.

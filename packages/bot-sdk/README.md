# @subspace/bot-sdk

A small SDK for Subspace Frequency bots: the REST API, the gateway, and slash-command interactions. Runs on **Node 18+, Deno and Bun**.

## Install

From the Subspace package registry. Point the `@subspace` scope at it (everything else still comes from npm):

```bash
npm config set @subspace:registry https://subspace.click/packages/npm/
npm install @subspace/bot-sdk
```

Deno: put `@subspace:registry=https://subspace.click/packages/npm/` in a `.npmrc` next to your `deno.json` (Deno reads it only in a project with one), then `import { SubspaceBot } from 'npm:@subspace/bot-sdk';`.

The gateway uses the runtime's built-in `WebSocket` (Node 22+, Deno, Bun). On Node 18 and 20, which have none, it loads the `ws` package instead.

## A slash-command bot

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
  return i.reply({ embeds: [{ title: `🎲 ${1 + Math.floor(Math.random() * sides)}` }] });
});
await bot.connect();
```

Slow answers: `i.defer()` within 3 seconds, then `i.followUp(...)` within 15 minutes; `i.editReply(...)` changes the reply.

## A bot that listens to messages

```ts
bot.on('message', (m) => {
  if (m.content === '!hello') void bot.send(m.channelType as 'relay', m.channelId, `Hi ${m.author.username}!`);
});
```

Events: `ready`, `message`, `messageUpdate`, `messageDelete`, `interaction`, `dispatch` (`type, data`), `close` (`code, reason`), `error`. The SDK reconnects on its own; `disconnect()` stops it.

## Interactions over HTTP

Check each request with `verifyInteraction(rawBody, signature, timestamp, publicKeyHex)` (sync, `node:crypto`; works on Node, Deno and Bun) or `await verifyInteractionAsync(...)` (WebCrypto only, e.g. for Cloudflare Workers), then answer with `respondWith(...)` or `deferWith(...)`.

A runnable example: `examples/dice-bot.mjs`. The full guide covers webhooks, bots, commands, embeds and signatures: `apps/docs/guide/bots.md`.

## Develop

```bash
pnpm --filter @subspace/bot-sdk build                     # dist/
cd packages/bot-sdk && deno test --allow-net deno/        # the SDK source under Deno, against a fake instance
node scripts/native/test.mjs tests/e2e/bots.test.ts       # end to end against the real API and gateway (repo root)
```

## License

The Subspace Frequency repository has no LICENSE file, so no license is granted yet.

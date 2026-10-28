# Deno bots

Deno runs the [JavaScript SDK](/developers/sdk/javascript), `@subspace/bot-sdk`, as an npm package. Everything on that page applies; this one covers the setup.

## Install

Deno reads npm registry settings from an `.npmrc`, but **only in a project with a `deno.json`**, and only from the folder that holds it. Put both side by side:

```
my-bot/
  deno.json
  .npmrc
  main.ts
```

`.npmrc`:

```ini
@subspace:registry=https://subspace.click/packages/npm/
```

`deno.json` (any valid one; `{}` is enough). Optionally map the import:

```json
{
  "imports": { "@subspace/bot-sdk": "npm:@subspace/bot-sdk@^0.1.0" }
}
```

Without the `.npmrc` in that place, Deno looks for the package on npmjs.com and doesn't find it.

## Quick start

`main.ts`:

```ts
import { SubspaceBot } from 'npm:@subspace/bot-sdk';

const bot = new SubspaceBot({ token: Deno.env.get('BOT_TOKEN')!, baseUrl: 'https://subspace.click' });

await bot.registerCommands([{ name: 'ping', description: 'Check the bot is alive' }]);
bot.on('interaction', (i) => (i.commandName === 'ping' ? i.reply('Pong!') : undefined));

await bot.connect();
```

```bash
deno run --allow-net --allow-env main.ts
```

The SDK uses Deno's built-in `WebSocket` for the gateway and `fetch` for REST, so it needs `--allow-net` (and `--allow-env` to read the token from the environment).

## HTTP interactions

`verifyInteraction` uses `node:crypto`, which Deno provides; `verifyInteractionAsync` uses WebCrypto. With `Deno.serve`:

```ts
import { verifyInteractionAsync, respondWith } from 'npm:@subspace/bot-sdk';

const publicKey = Deno.env.get('PUBLIC_KEY')!;

Deno.serve(async (req) => {
  const body = await req.text();
  const ok = await verifyInteractionAsync(body, req.headers.get('x-signature-ed25519') ?? '', req.headers.get('x-signature-timestamp') ?? '', publicKey);
  if (!ok) return new Response('invalid signature', { status: 401 });
  const interaction = JSON.parse(body);
  return Response.json(respondWith(`Hello ${interaction.user.username}`));
});
```

See [Slash commands](/developers/commands#over-http-instead-of-the-gateway) for the protocol.

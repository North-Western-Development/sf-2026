# @subspace/rich-presence

Show what a player is doing in your game on their Subspace Frequency profile: the map, their party, how long the match has run. It talks to the Subspace desktop app on the same computer over its local RPC server; the desktop app shares it with the player's friends as their Activity Privacy allows.

Needs a global `WebSocket`: Node 22 or later, Deno, Bun or Electron. Browsers cannot connect (the desktop app refuses them).

## Install

From the Subspace package registry. Point the `@subspace` scope at it:

```bash
npm config set @subspace:registry https://subspace.click/packages/npm/
npm install @subspace/rich-presence
```

## Use

```ts
import { RichPresence } from '@subspace/rich-presence';

const presence = new RichPresence({ clientId: '1234567890' }); // your application's id
await presence.connect(); // keeps looking in the background while the desktop app is closed

await presence.setActivity({
  details: 'Competitive · Mirage',
  state: 'In a match',
  startedAt: Date.now(),
  party: { size: 2, max: 5 },
  largeImage: 'https://cdn.example.com/maps/mirage.png',
  buttons: [{ label: 'Watch', url: 'https://example.com/match/123' }],
});

await presence.clearActivity();
presence.close(); // the activity ends with the connection
```

The activity shows your application's name and, unless you send your own art, its icon. After the desktop app restarts, the SDK reconnects and sends the activity again.

Full guide: https://docs.subspace.click/developers/rich-presence/

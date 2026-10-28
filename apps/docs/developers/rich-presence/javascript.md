# Rich Presence for JavaScript and TypeScript

`@subspace/rich-presence` talks to the Subspace desktop app from Node, Deno, Bun or Electron. It has no dependencies and ships its types. Source: `packages/rich-presence`.

| | |
| --- | --- |
| Package | `@subspace/rich-presence` (ES module) |
| Runs on | Anything with a global `WebSocket`: Node 22+, Deno, Bun, Electron |

## Install

From the [package registry](/developers/registry):

```bash
npm config set @subspace:registry https://subspace.click/packages/npm/
npm install @subspace/rich-presence
```

In Deno, put `@subspace:registry=https://subspace.click/packages/npm/` in an `.npmrc` next to your `deno.json` and import `npm:@subspace/rich-presence`.

## Quick start

```ts
import { RichPresence } from '@subspace/rich-presence';

const presence = new RichPresence({ clientId: '1234567890' });
await presence.connect(); // keeps looking in the background if the desktop app is closed

await presence.setActivity({
  details: 'Competitive · Mirage',
  state: 'In a match',
  startedAt: Date.now(),
  party: { size: 2, max: 5 },
  largeImage: 'https://cdn.example.com/maps/mirage.png',
  largeText: 'Mirage',
  buttons: [{ label: 'Watch', url: 'https://example.com/match/123' }],
});

// Later:
await presence.clearActivity();
presence.close(); // the activity also ends when your process exits
```

## API

### `new RichPresence(options)`

| Option | Default | |
| --- | --- | --- |
| `clientId` | | Your application id. Anything that isn't 1 to 19 digits throws `RichPresenceError`. |
| `reconnect` | `true` | Keep looking for the desktop app, and reconnect when it restarts |
| `ports` | `RPC_PORTS` (6473 to 6482) | Where to look |
| `host` | `'127.0.0.1'` | `'127.0.0.1'` or `'localhost'` |

### Methods and events

| Member | |
| --- | --- |
| `connect(): Promise<void>` | Finds the desktop app. With `reconnect` on it resolves even when the app isn't running, and keeps looking every 15 seconds; with it off, it rejects instead. |
| `setActivity(activity): Promise<void>` | Sets [the activity](/developers/rich-presence/#the-activity). Rejects with the desktop app's error, or after 10 seconds without a reply. While not connected it resolves at once and keeps the activity for when it connects. |
| `clearActivity(): Promise<void>` | Clears it |
| `close()` | Disconnects and stops looking |
| `connected` | Whether it is connected now |
| `on('ready' \| 'disconnected', listener)` | Returns a function that removes the listener |

Types: `Activity`, `ActivityType` (`'playing' | 'streaming' | 'listening' | 'watching' | 'competing'`), `ActivityButton` (`{ label, url }`); errors are `RichPresenceError`.

## Async model

- Everything runs on the event loop; nothing blocks.
- `connect()` tries all the ports at once and takes the first, in port order, that answers `READY` (within 3 seconds).
- The retry timer doesn't keep your process alive: a script that has nothing else to do exits.
- After the desktop app restarts, it reconnects and sends the last activity again.
- `close()` doesn't fire `disconnected`.

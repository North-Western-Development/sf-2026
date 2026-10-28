# @subspace/activity-sdk

Build **Activities** for Subspace Frequency: web apps that people open together inside a comm-link
(voice channel), like Discord Activities. Your page runs in a sandboxed iframe on **your own https
origin**; this SDK is its only line to Subspace. Browser ESM, TypeScript types, no dependencies.

```sh
npm install @subspace/activity-sdk
```

## 1. Register the Activity

In **User Settings › Developer Applications**, open (or create) your application and choose
**Add Activity**: a name, a short description, the page's URL and how many people one instance
holds. The application's icon is the Activity's icon.

- The URL must be `https://` (plain `http://localhost` works only on a development instance),
  without a `#fragment`, and on **your** domain: never the instance's own domain or a subdomain of it.
- You and your team (Developer role or above) can launch it straight away to test it; it shows
  as *Testing* in the launcher. Everyone else sees it once the instance's staff approve it
  (Command Console › Activities). **Changing the URL withdraws the approval** until they look again.
- Send `Content-Security-Policy: frame-ancestors https://your-subspace-instance` so no one else can frame your page.

## 2. Connect

```ts
import { ActivitySdk } from '@subspace/activity-sdk';

const sdk = new ActivitySdk({
  clientId: '123456789012345678',              // your application ID
  allowedOrigins: ['https://subspace.click'],   // the instance(s) that may host you
});
await sdk.ready();

sdk.instance;      // { id, channelId, beaconId, hostId }: id is your multiplayer room key
sdk.user;          // { id, username, displayName, avatarUrl }: who is looking (unverified, see below)
sdk.participants;  // everyone in this instance

sdk.on('participants', (people, hostId) => render(people));
```

Create the SDK when the page starts: it reads its launch parameters from the URL fragment.

## 3. Know who someone really is: `authorize()`

`sdk.user` is fine for showing names, but **never trust it for anything that matters**: any page
can frame yours and claim to be Subspace. To prove identity, ask for an OAuth2 code and exchange
it on your backend with your client secret:

```ts
const { code } = await sdk.authorize({ scopes: ['identify'] }); // Subspace asks the person first
await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
```

Your backend (Node 18+):

```js
// POST /api/session { code }
const SUBSPACE = 'https://subspace.click';
const token = await fetch(`${SUBSPACE}/api/v1/oauth2/token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: 'Basic ' + Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64'),
  },
  // No redirect_uri: an Activity's code was never redirected, so sending one fails.
  body: new URLSearchParams({ grant_type: 'authorization_code', code }),
}).then((r) => r.json());

const me = await fetch(`${SUBSPACE}/api/v1/oauth2/@me`, {
  headers: { authorization: `Bearer ${token.access_token}` },
}).then((r) => r.json());
// me.user is who they are. Start your own session; keep the token server-side.
```

Codes last ten minutes, work once, and only for your application. Scopes: `identify`, `email`,
`beacons`. The person can revoke you any time in User Settings › Authorized Apps.

## 4. Play together

Sync game state through your own backend, using `sdk.instance.id` as the room key: everyone in
the same instance gets the same id.

For small things there is a relay:

```ts
sdk.broadcast({ type: 'move', x: 3, y: 4 });            // to everyone else in the instance
sdk.on('message', ({ from, payload }) => apply(from, payload));
```

Broadcasts are JSON, at most 4 KB, rate-limited, never stored (late joiners do not get old ones),
and come from whoever sent them: check them like any user input.

## 5. Everything else

```ts
await sdk.openExternalLink('https://example.com/rules'); // through Subspace's "Leaving Subspace" check
sdk.destroy();                                           // stop listening
```

Errors are `ActivitySdkError` with a `code`: `NOT_LAUNCHED` (not opened from Subspace),
`NOT_FRAMED`, `ORIGIN_NOT_ALLOWED`, `ORIGIN_MISMATCH`, `ORIGIN_UNVERIFIED`, `TIMEOUT`, `USER_CANCELLED`, `RATE_LIMITED`,
`INVALID_SCOPE`, `TOO_LARGE`, `UNKNOWN_COMMAND`, `BUSY`, `NOT_IN_ACTIVITY`.

## What your page can and cannot do

It runs with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`,
`allow="autoplay; fullscreen"` (no camera, microphone, screen, location or clipboard),
`referrerpolicy="no-referrer"` and, where the browser supports it, `credentialless` (a fresh
storage partition each time, so set your session cookie after `authorize()`, with
`SameSite=None; Secure; Partitioned`). It cannot navigate Subspace's tab or reach its page.
Closing or leaving the activity removes the frame entirely.

People see a notice before your page first loads: that it is run by you, not by the instance, and
that it connects from their device, so you see their IP address. Treat that as personal data.

## Example

[`examples/counter`](./examples/counter): a shared counter with names and avatars, a
`broadcast()` sync, and a Node backend that exchanges the `authorize()` code.

```sh
pnpm build   # in packages/activity-sdk, so examples/counter can serve dist/index.js as /sdk.js
SUBSPACE_URL=https://subspace.click CLIENT_ID=... CLIENT_SECRET=... node examples/counter/server.mjs
```

Serve it over https (a tunnel or reverse proxy) and register that URL as the Activity URL.

## The protocol

`window.postMessage`, version 1. Subspace loads `ACTIVITY_URL#frame_id=<32 hex>&parent_origin=<origin>&instance_id=<id>`.
The SDK posts `{ subspace: 'activity', v: 1, frameId, nonce, cmd, args }` to `window.parent` with
`targetOrigin` set to that origin (never `*`); Subspace answers `{ subspace: 'host', v: 1, frameId, nonce, ok, data | error }`
and sends events `{ subspace: 'host', v: 1, frameId, event: 'participants' | 'message', data }`.
Commands: `HANDSHAKE { clientId, v }`, `AUTHORIZE { scopes }`, `OPEN_EXTERNAL_LINK { url }`,
`BROADCAST { payload }`. Each side drops anything not from the other's window, origin and frame id.

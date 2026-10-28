# Activities

Activities are web apps people open together inside a comm-link, like Discord Activities. Next to
the built-in ones (Watch Together, Whiteboard), developers add their own from **User Settings ›
Developer Applications**, and build them with `@subspace/activity-sdk` (from the [package registry](/developers/registry); `packages/activity-sdk` in the repository)
(its README has the full walkthrough and an example).

This page is the security and privacy model: what a third-party page can and cannot do, and why.

## Who can launch what

| | Launch | Join | Seen in the launcher |
| --- | --- | --- | --- |
| Approved by staff | anyone in the comm-link with *Use Activities* | anyone in the comm-link with *Use Activities* | everyone |
| Not approved yet | the application's owner and team members with the Developer role or above | the same | the same, marked *Testing* |

- Staff approve in **Command Console › Activities** (the *Manage developers* permission). Every
  approval and withdrawal is in the Staff Log.
- **A new URL withdraws the approval**: it is a different page. Renaming or changing the
  description does not.
- Approval is checked on every start and every join, and when the activity asks for an
  authorization code. Withdrawing it stops new people; the people already in a running instance
  keep it until they leave.
- An instance holds at most the Activity's *max participants*.

## Registration rules

The Activity URL is checked on save (`apps/api-service/src/lib/app-activities.ts`):

- `https://` only. Outside production, `http://localhost` is allowed for development.
- No username or password, no `#fragment` (the client uses the fragment for its handshake).
- **Not on our site**: not the instance's own host (`PUBLIC_ORIGIN`) and not a host under its
  site (for `chat.example.com`, nothing under `example.com`). Same-site pages could set cookies
  for us ("cookie tossing") and would make `allow-same-origin` dangerous (below).
- Not a private, loopback, link-local or unresolvable address (the same check as bot interaction
  URLs). In tests `UNFURL_ALLOW_PRIVATE_HOSTS` can allow `localhost`; production ignores it.

## Isolation

The page runs in an `<iframe>` pointing at the developer's own origin, with:

| Attribute | Value | Why |
| --- | --- | --- |
| `sandbox` | `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox` | No top navigation (it cannot move the Subspace tab), no modals, no downloads, no pointer lock. |
| `allow` | `autoplay; fullscreen` and `'none'` for camera, microphone, screen capture, geolocation, clipboard, payment, USB, serial, HID | Nothing powerful. The instance's `Permissions-Policy` header keeps camera, microphone and screen capture to Subspace itself anyway. |
| `referrerpolicy` | `no-referrer` | The page does not learn which beacon or channel URL it was opened from. |
| `credentialless` | (Chromium) | A fresh, throwaway storage partition: the page cannot recognise someone from cookies it set elsewhere. |

**Why `allow-same-origin` is safe here.** With `allow-scripts`, `allow-same-origin` is dangerous
only when the framed page is same-origin with its embedder: it could then reach into the parent
and remove its own sandbox. Activity pages are always on a foreign origin (enforced at
registration and again in the client), so `allow-same-origin` only lets the page keep *its own*
origin: its storage and its own backend work, and Subspace can check `event.origin` against the
registered origin. Without it every Activity would share the opaque origin `null`, and messages
from one could not be told apart from another's.

**What decides what loads.** The instance's CSP has `frame-src https:`, so the browser allows any
https frame; the client only ever loads the URL our API returns for the activity you are in
(approved, or your own team's), refuses our own origin and site, and rebuilds the URL itself.
`frame-ancestors 'none'` and `X-Frame-Options: DENY` still stop anyone from framing Subspace.

**Lifecycle.** Leaving the activity, the comm-link or the channel view removes the iframe; nothing
keeps running in the background. The instance ends when its last participant leaves.

## Privacy notice

Before a third-party page loads for the first time, the person sees:

> *App* by *developer* will see your username, avatar and who is in this activity. It is run by
> its developer, not by this instance, and connects from your device (they can see your IP address).

with where it runs and, if it is not approved yet, a *not reviewed* warning. Continue or Cancel;
nothing is fetched from the developer before Continue.

The choice is remembered **per account, per application and per origin, on this device**
(`localStorage`). Per device, because the IP address it reveals is the device's; per origin,
because a new origin is a different third party. If storage is cleared or unavailable they are
asked again; the frame itself refuses to load without it, whichever way they joined. This is
deliberate: Subspace never contacts the developer's server on anyone's behalf, so no IP address
reaches a third party until the person agrees, and none at all through the instance.

## The bridge

The page talks to Subspace only with `window.postMessage`, through the SDK:

- Subspace loads `URL#frame_id=<128-bit random>&parent_origin=<instance origin>&instance_id=<id>`;
  a new `frame_id` for every frame.
- **The parent** accepts a message only if `event.source` is that iframe's `contentWindow`,
  `event.origin` is the registered origin, and `frameId` matches. It posts back with
  `targetOrigin` set to the registered origin, so if the frame navigated elsewhere nothing is
  delivered. Anything else is dropped without an answer (the frame's `data-ignored-messages`
  counts them in tests).
- **The SDK** accepts a message only from `window.parent`, from the parent origin, with its frame
  id and the nonce of a request it is waiting for (each nonce answers once). It sends with
  `targetOrigin` set to the parent origin, never `*`. The parent origin comes from the fragment,
  must be in the developer's `allowedOrigins` when set, and must match
  `location.ancestorOrigins[0]` where the browser has it.
- Commands: `HANDSHAKE`, `AUTHORIZE`, `OPEN_EXTERNAL_LINK`, `BROADCAST`. Anything else is
  refused (`UNKNOWN_COMMAND`), so is anything before the handshake (`NOT_READY`) and any message
  over 16 KB. 20 commands a second per frame; one authorization prompt at a time.
- There is no ambient access: no token, no API, no DOM, no cookies of ours. The handshake gives
  the instance (id, comm-link id, beacon id, host), the person's public profile (id, username,
  display name, avatar) and the participants' public profiles; updates follow as people come
  and go.

### Identity: `authorize()`

Anything a page gets over postMessage could come from a fake parent (any site can frame the
page and claim to be Subspace), so the profile from the handshake is for display only. Identity
comes from OAuth2:

1. The page calls `sdk.authorize({ scopes })`.
2. Subspace asks the person (an in-app consent prompt listing the scopes) unless they already
   granted those scopes to the app; the API refuses to skip the prompt otherwise (`CONSENT_REQUIRED`).
3. `POST /relays/:relayId/activities/:id/authorize` checks the person is in that activity and the
   app may still be launched by them, records the grant (it appears in Authorized Apps), and mints
   an authorization code bound to **the application, the person and the instance**, with **no
   redirect URI**, single use, ten minutes. Ten a minute per person.
4. The page sends the code to its backend, which redeems it at `POST /api/v1/oauth2/token` with
   the client secret and **without** `redirect_uri` (a code with a redirect URI cannot be redeemed
   without it, and an Activity code cannot be redeemed with one), then calls `/oauth2/@me`.

The browser side never sees the client secret or a token.

### Multiplayer

The instance id is the room key for the developer's own backend. For small state, `broadcast()`
relays JSON through the gateway (`ACTIVITY_MESSAGE` to the instance's other participants): 4 KB at
most, 30 events a second per person (shared with built-in activity events), never stored.

## API

| Route | Who | |
| --- | --- | --- |
| `GET /applications/:id/activity` | team, read-only and up | The app's Activity |
| `PUT /applications/:id/activity` | team, Developer and up | `{ name, description?, url, maxParticipants? }` create or update |
| `DELETE /applications/:id/activity` | team, Developer and up | Remove it |
| `GET /activities/apps` | signed in | What I may launch |
| `POST /relays/:relayId/activities` | in the comm-link | `{ kind: 'app', appId }` start one |
| `POST /relays/:relayId/activities/:id/authorize` | in the activity | `{ scopes, consent? }` a code |
| `POST /relays/:relayId/activities/:id/events` | in the activity | `{ type: 'message', data: { payload } }` broadcast |
| `GET /console/activities` | staff, Manage developers | Every Activity |
| `PUT\|DELETE /console/activities/:appId/approval` | staff, Manage developers | Approve or withdraw |

## Limits of the model

- Approval is a human review of a page that can change behind the same URL. Staff should only
  approve developers they trust; withdrawing approval is immediate for new launches and joins.
- The frame sees the person's IP address and whatever they type into it. The notice says so;
  the instance cannot see or limit what the developer does with it.
- `credentialless` is Chromium-only; elsewhere the frame gets normal (partitioned) third-party storage.
- The SDK checks who really framed it: `location.ancestorOrigins` where the browser has it, and
  in Firefox the referrer Subspace sends (`referrerPolicy="origin"`, only the origin already in
  the URL). A page that hides its referrer is refused unless `allowedOrigins` is set. Any site
  can still frame your page under its own name, as in every browser: set `allowedOrigins`
  and `frame-ancestors` to keep it to Subspace.

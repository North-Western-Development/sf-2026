# Getting started for developers

Everything you build on Subspace starts as a **Developer Application** (Discord's *application*). One application can be any mix of:

- a **bot**: an account that joins beacons (servers), reads and sends transmissions (messages), and answers [slash commands](/developers/commands);
- an **OAuth2 client** for [Sign in with Subspace](/developers/oauth2);
- the identity behind a game's [Rich Presence](/developers/rich-presence/).

Webhooks need no application: anyone with *Manage Webhooks* makes one in a relay (channel). See [Webhooks](/developers/webhooks).

Examples use `https://subspace.click`. Every instance runs the same platform, so use your own instance's address where yours lives elsewhere.

## Create an application

**User Settings › Developer Applications › New Application.** Give it a name (2 to 32 characters) and, if you like, a description (up to 400 characters). One account can own up to 25 applications.

| You get | What it is |
| --- | --- |
| **Application ID** | A snowflake (`"1234567890123456789"`). It is also the OAuth2 `client_id` and the Rich Presence `clientId`. |
| **Client secret** | For the OAuth2 token endpoint. Shown **once**, when the application is made; **Reset Secret** makes a new one and the old one stops working at once. |
| **Redirect URIs** | Up to 10, for OAuth2. Each must be `https://`, or `http://` to `localhost`, `127.0.0.1` or `[::1]`, without a `#fragment`. |

From there, **Add Bot** makes its [bot](/developers/bots).

The same things over the API (with a person's session, never a bot token):

| Endpoint | Does |
| --- | --- |
| `GET /api/v1/applications` | Your applications, and those of teams you are in, each with your `role` |
| `POST /api/v1/applications` | `{ name, description?, redirectUris? }`: answers `{ application, clientSecret }` |
| `PATCH /api/v1/applications/<id>` | `{ name?, description?, redirectUris? }` (Developer role or above) |
| `POST /api/v1/applications/<id>/secret` | A new client secret: `{ clientSecret }` (Developer or above) |
| `DELETE /api/v1/applications/<id>` | Deletes it (Admin or above) |
| `GET /api/v1/applications/policy` | What this instance lets you do as a developer, and what you are missing (see below) |

## Teams

Several people can work on the same applications in a **team** (**Developer Applications › Teams › New Team**). Invite people as `name#1234`; they join when they accept. Each member has a role:

| Role | Can |
| --- | --- |
| Owner | Everything, including deleting the team. Applications in a team belong to its owner. |
| Admin | Everything but deleting the team: add and remove members (only the owner adds or removes admins), delete applications and bots, move applications in and out. |
| Developer | Edit the team's applications and bots, see and reset their secrets and tokens, add the team's private bots to beacons. |
| Read-only | See the applications and their settings, but no secrets or tokens. |

Move an application into a team from its card (**Move to team…**). Deleting a team gives its applications back to the owner.

::: info Commands are registered by the owner
Besides the bot itself, only the application's **owner** can register its slash commands with a personal session. Team members register them with the bot token.
:::

The team endpoints, for reference: `GET|POST /api/v1/teams`, `PATCH|DELETE /api/v1/teams/<id>`, `POST /api/v1/teams/<id>/members` (`{ username, discriminator, role }`), `PATCH|DELETE /api/v1/teams/<id>/members/<userId>`, `POST /api/v1/teams/<id>/accept`, and `POST /api/v1/applications/<id>/team` (`{ teamId }`, or `null` to move it out). Roles are `admin`, `developer` and `read_only`.

## Developer policy

Each instance decides who may build, in **Command Console › Developers** (staff with *Manage developers*). Out of the box everything is open.

- **What makes an account verified**: a verified email, a verified phone number, or verification by staff. Any one of the ones the instance picks is enough.
- **Who can create applications**: anyone, or verified accounts only. Separately, a verified email and/or phone number can be required of everyone.
- **Who can turn on each privileged intent** ([Message Content and Activity Status](/developers/bots#privileged-intents)): any developer, or verified developers only.

**Developer Applications** says what is missing when something is not allowed. Over the API, creating an application is refused with `403 APP_CREATION_RESTRICTED` (its `missing` lists what is needed), and turning on an intent with `403 INTENT_RESTRICTED`. A bot that already has an intent loses it straight away if its developer stops qualifying, and gets it back when they qualify again.

`GET /api/v1/applications/policy` answers:

```json
{
  "verification": { "email": true, "phone": false, "staff": false, "verified": true },
  "verifiedMeans": "a verified email, a verified phone number or verification by staff",
  "createApps": { "allowed": true, "missing": [] },
  "intents": {
    "messageContent": { "allowed": true, "audience": "everyone" },
    "activity": { "allowed": true, "audience": "verified" }
  }
}
```

## Verified bots and games

Accounts that are not people carry a tag next to their name: **APP** for a bot, **HOOK** for a webhook, and **BEACON** on an announcement copied from a relay another beacon follows.

- Instance staff can verify a well-known bot in **Command Console › Transmitters › Verify**. Its tag then shows a check (**✓ APP**) everywhere, so a copy with the same name and picture can't pass for it.
- Staff with *Verify games* can link a detected game to your application in **Command Console › Verified Games**, so people playing it show your application's icon instead of the Steam cover. See [Rich Presence](/developers/rich-presence/#art-for-a-detected-game).

## Where next

- [Bots](/developers/bots): tokens, intents, permissions and the invite link.
- [REST API](/developers/rest), [Gateway](/developers/gateway) and [Gateway events](/developers/events).
- [SDKs](/developers/sdk/javascript) for JavaScript, Deno, Python, Java, C# and C++, all on the [package registry](/developers/registry).

# Sign in with Subspace (OAuth2)

Any [Developer Application](/developers/) can let people sign in to your site or app with their Subspace account, like Discord's OAuth2. It is the **authorization code** grant, with optional **PKCE**, refresh tokens and revocation.

What an app's token can reach is small on purpose: who the person is, optionally their email and their beacons (servers). It never reaches the rest of the API.

## Set up

In **Developer Applications**, add your callback URL to the application's **Redirect URIs** (up to 10; `https://`, or `http://` to `localhost`, `127.0.0.1` or `[::1]`; no `#fragment`). Note the **Application ID** (your `client_id`) and the **client secret** (shown once; **Reset Secret** makes a new one).

## Scopes

| Scope | Gives |
| --- | --- |
| `identify` | Their id, username, discriminator, display name and avatar |
| `email` | Their email address, and whether it is verified (with `identify`) |
| `beacons` | The beacons they are in |

`bot` is not an OAuth2 scope here: `scope=bot` on the same page is the [Add to beacon](/developers/bots#add-it-to-a-beacon) flow for bots, and must be alone.

## 1. Send them to the consent screen

```
https://subspace.click/oauth2/authorize
  ?client_id=1234567890123456789
  &redirect_uri=https%3A%2F%2Fexample.com%2Fcallback
  &response_type=code
  &scope=identify%20email
  &state=Xf3k9…
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
```

| Parameter | |
| --- | --- |
| `client_id` | Your application id |
| `redirect_uri` | Exactly one of the registered Redirect URIs |
| `response_type` | `code` (the only one) |
| `scope` | Scopes separated by spaces (or `+`) |
| `state` | Optional, up to 500 characters: comes back unchanged. Use it to tie the answer to the person's session. |
| `code_challenge` | Optional PKCE challenge: base64url of the SHA-256 of a random `code_verifier` (43 to 128 characters). Only `S256` is supported. |

Someone not signed in signs in first. They see your application's name, icon, description and owner, and the scopes, and choose **Authorize** or **Cancel**. **Cancel** takes them back into Subspace: your redirect URI is not called, so treat a sign-in that never comes back as cancelled. Authorizing again later adds any new scopes to what they granted before.

## 2. Get the code

Subspace sends them back to your redirect URI:

```
https://example.com/callback?code=…&state=Xf3k9…
```

Check `state`. The code works **once**, for **10 minutes**.

## 3. Exchange it for tokens

```http
POST /api/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=…&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&code_verifier=…
```

Authenticate the client with HTTP Basic (`Authorization: Basic base64(client_id:client_secret)`) or with `client_id` and `client_secret` in the body. A JSON body works too.

`redirect_uri` must be the one the code was issued for. `code_verifier` is required when you sent a `code_challenge`.

```json
{
  "access_token": "…",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "…",
  "scope": "identify email"
}
```

Access tokens last **7 days**, refresh tokens **30 days**.

## 4. Call the API

```http
GET /api/v1/oauth2/@me
Authorization: Bearer <access_token>
```

```json
{
  "application": { "id": "…", "name": "My Site" },
  "scopes": ["identify", "email"],
  "expires": "2026-11-04T12:00:00.000Z",
  "user": {
    "id": "…",
    "username": "sam",
    "discriminator": "1234",
    "displayName": "Sam",
    "avatarUrl": "https://…",
    "email": "sam@example.com",
    "verified": true
  }
}
```

`user` is present only with `identify`, and `email` and `verified` only with `email` too. `verified` is `false` on an instance that doesn't verify email addresses.

With the `beacons` scope:

```http
GET /api/v1/oauth2/@me/beacons
Authorization: Bearer <access_token>
```

```json
{ "beacons": [{ "id": "…", "name": "Night Owls", "iconUrl": null, "owner": false }] }
```

Without the scope it answers `403`; with an invalid or expired token, `401`.

## Refreshing

```http
POST /api/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=…
```

(with the client's credentials, as above). The answer is a new access token **and a new refresh token**: the old refresh token stops working. A refreshed token never has more scopes than it had, nor more than the person still grants.

## Revoking

```http
POST /api/v1/oauth2/token/revoke
Content-Type: application/x-www-form-urlencoded

token=…
```

(with the client's credentials). It revokes that access or refresh token and always answers `200 {}`, whether or not the token existed.

People can see and remove the apps they authorized in **User Settings › Authorized Apps**. Removing one cuts the app off at once: every token it holds stops working.

## Errors

The token endpoints answer as OAuth2 describes:

```json
{ "error": "invalid_grant", "error_description": "The code is invalid, used or expired" }
```

| `error` | Status | When |
| --- | --- | --- |
| `invalid_client` | 401 | Wrong client id or secret |
| `invalid_request` | 400 | `code` or `refresh_token` missing |
| `invalid_grant` | 400 | The code is wrong, used or expired; issued to another client or redirect URI; the verifier doesn't match; the authorization was removed; the refresh token is invalid or expired |
| `unsupported_grant_type` | 400 | Not `authorization_code` or `refresh_token` |
| `temporarily_unavailable` | 503 | Try again later |

On the consent step, an unregistered `redirect_uri`, an unknown application or an unknown scope stops at the consent screen with an error; nothing is sent to your redirect URI.

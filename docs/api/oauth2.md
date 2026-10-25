# Sign in with Subspace (OAuth2)

Apps that let people sign in with their Subspace account. Create one in
**User Settings › Developer Applications**: you get a Client ID and a Client Secret (shown
once; reset it if it leaks), and you register the redirect URIs the app uses.

People see and revoke the apps they authorized in **User Settings › Authorized Apps**.

## Scopes

| Scope      | Grants                                         |
|------------|------------------------------------------------|
| `identify` | id, username, tag, display name and avatar     |
| `email`    | email address and whether it is verified       |
| `beacons`  | the beacons they are in (id, name, icon, owner)|

An app token reaches only the endpoints below, never the rest of the API.

## Flow (authorization code, PKCE recommended)

1. Send the person to

   ```
   https://<site>/oauth2/authorize?client_id=<id>&redirect_uri=<registered uri>
     &response_type=code&scope=identify%20email&state=<random>
     &code_challenge=<base64url(sha256(verifier))>&code_challenge_method=S256
   ```

   They approve on the consent page and come back to `redirect_uri?code=…&state=…`.
   Redirect URIs must match a registered one exactly: `https`, or `http` on localhost.

2. Exchange the code (single use, 10 minutes) at `POST /api/v1/oauth2/token`, form-encoded,
   authenticating with HTTP Basic (`client_id:client_secret`) or the two body fields:

   ```
   grant_type=authorization_code&code=…&redirect_uri=…&code_verifier=…
   ```

   The reply: `access_token` (7 days), `refresh_token` (30 days), `token_type: Bearer`, `scope`.

3. Refresh with `grant_type=refresh_token&refresh_token=…`. Refresh tokens rotate: the old one
   stops working.

4. Revoke with `POST /api/v1/oauth2/token/revoke` and `token=…` (client authentication as above).

## Endpoints for apps

- `GET /api/v1/oauth2/@me` with `Authorization: Bearer <access_token>`: the application, the
  granted scopes, the token's expiry, and `user` (with `identify`; `email` adds the email).
- `GET /api/v1/oauth2/@me/beacons`: needs the `beacons` scope.

Errors from the token endpoints follow RFC 6749 (`error`, `error_description`).

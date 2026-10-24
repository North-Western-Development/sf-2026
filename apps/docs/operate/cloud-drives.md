# Cloud drives

People can import files from Google Drive, Microsoft OneDrive and Dropbox into their Vault, or attach them to a transmission (+ → **Attach from Cloud Drive**). Each drive is off until you register an app with the provider and set its id and secret.

| Provider | Variables | Scope to request |
| :--- | :--- | :--- |
| Google Drive | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `drive.readonly` |
| Microsoft OneDrive | `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET` | `Files.Read`, `User.Read`, `offline_access` |
| Dropbox | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` | `files.content.read` |

Register these redirect URIs with each provider (one per address people use):

```
https://subspace.click/api/v1/vault/drives/google/callback
https://subspace.click/api/v1/vault/drives/onedrive/callback
https://subspace.click/api/v1/vault/drives/dropbox/callback
```

## How it is protected

- Sign-in is an OAuth authorization-code flow with PKCE, done by the file service.
- The OAuth state is sealed (AES-GCM) and bound to the browser that started it by an HttpOnly cookie, so a consent link cannot be replayed into someone else's account.
- Drive tokens are stored encrypted with `DRIVE_TOKEN_KEY` (default: derived from `JWT_SECRET`), refreshed when they expire, and revoked at the provider on disconnect.
- Imports follow the normal upload rules: the first-upload disclaimer, 50 MB per file, and the personal quota. Google Docs, Slides and Drawings are exported as PDF or PNG.

# Mobile push

The mobile app tells the instance where to push once someone signs in. The API pushes:

- every transmission in direct links and meshes;
- mentions in beacons;
- incoming calls.

Nobody gets a push for:

- conversations or beacons they muted, or with mobile push turned off;
- anything while they are in Do Not Disturb;
- their own transmissions.

Push never goes through a third-party relay. Each phone shows whether it gets pushes, and why not, in **User Settings › Notifications**.

## Android: UnifiedPush

Android phones use [UnifiedPush](https://unifiedpush.org): the person installs a distributor app such as [ntfy](https://ntfy.sh), and Subspace registers with it. The instance sends each push to the endpoint the distributor gave. The push is encrypted to that phone's own keys ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)), so the push server in between relays ciphertext it cannot read. The phone then shows the sender and a preview.

Run your own ntfy server for it with `deploy/server/06-push.sh`:

1. Point `push.<your domain>` at the server.
2. Run `bash 06-push.sh` as root.

The script:

- installs ntfy;
- closes every topic except UnifiedPush's random ones;
- turns off sign-up, the web app and attachments;
- adds the name to the certificate;
- sets `UNIFIEDPUSH_SERVER` for the API.

The app then tells people without a distributor to install ntfy and set its server to yours. ntfy keeps undelivered pushes, which are encrypted, for 12 hours.

Without a distributor app, Android notifications arrive only while Subspace is open.

## iOS: Apple Push Notification service

Only Apple can wake an iPhone app, so iOS push needs a key from an Apple Developer account. The instance sends to Apple directly, with no relay in between. Apple sees only "New transmission", "You were mentioned" or "Incoming call". It never sees who sent it or what it says.

1. In the Apple Developer account, under **Certificates, Identifiers & Profiles › Keys**, create a key with **Apple Push Notifications service (APNs)** enabled, and download the `.p8`.
2. Put it on the server as `/etc/subspace/apns.p8`.
3. Set these in `/etc/subspace/api.env`:
   - `APNS_KEY_FILE=/etc/subspace/apns.p8`
   - `APNS_KEY_ID` (the key's id)
   - `APNS_TEAM_ID`
   - `APNS_TOPIC`, if the app's bundle id is not `click.subspace.mobile`
4. Restart `subspace-api`. `06-push.sh` sets the key file's owner and mode when it finds it.

Without a key, iOS push shows as **Unavailable** in the app, and notifications arrive only while it is open. Sideloaded copies of the app (the `.ipa` from the downloads) can never receive push. Apple grants the push entitlement only to apps signed by a paid developer account.

## Details

- `GET /api/v1/push/config` (public) says what the instance can send: `{ apns, unifiedpush, ntfy }`.
- An account keeps at most 10 installs; registering an 11th drops the oldest.
- UnifiedPush endpoints must be https on a public address; each push is checked again and pinned to the checked address, like link previews.
- Tokens and endpoints that Apple or the push server report as gone are deleted.
- Encrypted conversations push only "Sent an encrypted transmission", because the server cannot read them.

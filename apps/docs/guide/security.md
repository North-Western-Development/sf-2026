# Security and encryption

## Accounts and sessions

- Passwords are hashed with Argon2id. Sign-in accepts `name#0000` or an email address.
- Each sign-in is a **device session**. Access tokens carry its id, so signing a device out (Settings → Devices), changing the password, or disabling the account cuts access immediately, in the API, the file service and the gateway, not when the token expires.
- Refresh tokens rotate and work once.
- Sensitive changes (email, username, password, passkeys, disabling or deleting the account) re-check the current password.
- Second factors: authenticator apps with backup codes, and **passkeys** for passwordless sign-in. Passkeys require user verification, so they count as both factors.
- New accounts verify their email address when SMTP is configured ([Email](/operate/email)).

## The API surface

- Every route needs a valid session unless it is explicitly marked public. A test sends every registered route anonymous, forged, expired and wrong-type tokens, and fails if any answers.
- Real-time events go only to the people the API resolved as the audience (relay viewers, mesh members, DM participants). Call states never leave the conversation.
- Rate limits protect sign-in, sign-up, invites, link previews, passkeys and email resends.

## Files and link previews

- Uploads are checked server-side: an upload is recorded only if it was ticketed to the same account, and at its real stored size.
- User content is served with `Content-Security-Policy: sandbox` so it can never run as the app.
- Link previews fetch pages server-side through a guarded fetcher. It resolves every redirect hop, refuses private, loopback, link-local, CGNAT and multicast addresses (including IPv4-mapped IPv6), and pins the connection to the address it checked. Preview images are served through a signed proxy, so viewers never contact third-party hosts.

## End-to-end encryption

### Direct links and group DMs

Anyone in a direct link or a group DM (mesh) can turn on encryption (it cannot be turned off). From then on the server stores and accepts only ciphertext for that conversation. In a group, everyone needs a device that supports encryption first, and so does anyone added later.

- **Keys:** each browser or app install is a device with an identity key, a signing key, a signed prekey and one-time prekeys (P-256). Private keys are non-extractable and stay on the device.
- **Starting a conversation:** X3DH, with the signed prekey's signature checked so the server cannot swap keys.
- **Every message:** the Double Ratchet (HKDF-SHA-256, AES-256-GCM), encrypted separately for each recipient device and the sender's other devices. In a group that means every member's devices, so someone who leaves cannot read anything sent after, and someone added reads only from when they join.
- **Attachments:** encrypted on the device before upload; the storage only holds ciphertext.
- **Safety numbers:** the lock in the conversation header shows them, to compare in person. In a group, pick the member to compare with.

What it does not do: a device added later cannot read earlier messages. Search and link previews do not work in encrypted conversations, because the server cannot read them.

### Screenshot protection

While an encrypted direct link or group DM is open, the apps block screenshots and screen recording of it:

- **Desktop app:** the window is hidden from screenshots and screen capture (Windows and macOS).
- **Android:** the screen is marked secure.
- **iPhone and iPad:** screenshots and recordings come out blank.

It is lifted during a voice or video call, so screen sharing still works. Browsers have no way to do this. Protection only stops casual capture, and nothing stops a photo of the screen.

### Reporting an encrypted message

Staff cannot read encrypted conversations, so a report from one comes with the conversation shown to them in plain text. Before sending, the reporter is warned that the reported transmission and up to five on each side go to staff, with any attachments.

Reporters cannot make anything up. This works by **message franking**, after Facebook's design:

1. The sender's device picks a random key for each transmission and puts it inside the encrypted contents.
2. The server only receives a commitment: HMAC-SHA-256 of that key and the contents. It is stored with the transmission and is required on every encrypted transmission and edit.
3. A recipient's device checks the commitment against what it decrypted. If they do not match, it refuses the transmission, so everything it shows can be reported.
4. To report, the device reveals the contents and keys. The server picks the five transmissions on each side itself, in that conversation. It checks every reveal against its stored commitment and refuses the whole report if any does not match.

Staff see each transmission marked **Verified**, **Not verifiable**, or **Not shared**:

- **Not verifiable:** the transmission was sent before verification existed.
- **Not shared:** the reporter's device could not open it.

Anyone can only report transmissions they can see.

### Calls and Comm-Links

Calls in encrypted direct links and group DMs, and Comm-Links with **End-to-end encrypt voice and video** turned on (Beacon Settings → the relay), encrypt every audio and video frame in the browser.

- The first person in the room creates the frame key.
- Everyone who joins later gets it from the people already there, as Double Ratchet messages relayed by a server that cannot read them.
- The key is only given to someone the gateway shows as connected to that same room.
- When someone leaves, the key changes. The person left with the smallest id makes a new key and sends it to everyone still there. Each person first accepts frames under the new key, then switches their own sending to it 1.5 seconds later, so audio doesn't drop. Whoever left cannot decrypt anything after that.

## Reporting a vulnerability

Contact the instance operator. For the software itself, open a private security advisory on the repository rather than a public issue.

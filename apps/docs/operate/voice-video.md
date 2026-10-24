# Voice and video

Comm-Links (voice relays) and direct calls run on a [LiveKit](https://livekit.io) SFU.

- **Signaling** goes through the web edge at `/rtc`, so it shares the app's origin and certificate.
- **Media** flows directly between browsers and the server:

| Port | Protocol | Use |
| :--- | :--- | :--- |
| 50000-50100 | UDP | Audio and video (preferred) |
| 7881 | TCP | Fallback for networks that block UDP |

Open both in the server firewall. The range allows roughly 100 concurrent media tracks; widen `port_range_start` / `port_range_end` in `docker/livekit.staging.yaml` and the compose port mapping together if you need more.

Keys: `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `.env`, shared by LiveKit and the API, which issues room grants. Set `LIVEKIT_PUBLIC_URL` only if signaling is served from another address.

## Restrictive networks

Some corporate networks allow only TCP 443. LiveKit's built-in TURN server can serve those users; see LiveKit's TURN documentation, then add the `turn` section to `docker/livekit.staging.yaml`.

## Encrypted Comm-Links

In Beacon Settings → a Comm-Link → **End-to-end encrypt voice and video**, every frame is encrypted in the browser with a key only participants hold ([how](/guide/security#calls-and-comm-links)). The SFU still routes the media but cannot decode it. Everyone needs a browser with insertable streams (Chromium-based browsers and Safari).

# Subspace Frequency - Terminology Translation Guide

This document maintains the canonical mapping between traditional messaging/chat terminology and the space-themed domain lexicon used in Subspace Frequency across all codebases, schemas, APIs, UI strings, and documentation.

---

## Core Domain Terms

| Traditional Term | Subspace Frequency Term | Description / Context |
| :--- | :--- | :--- |
| **User / Account** | **Transmitter** | An individual entity/account broadcasting and receiving communications on the network. |
| **Message** | **Transmission** | An individual payload of text, media, or encrypted data sent to a relay or direct link. |
| **Server** | **Beacon** | A logical collective hub containing relays, members, and clearance roles. |
| **Channel** | **Relay** | A specific stream for transmissions (text, audio, holo-cast, forum, gallery). |
| **Text Channel** | **Text Relay** | Standard synchronous text and file exchange relay. |
| **Voice Channel** | **Comm-Link Relay** | Audio/video stream relay powered by LiveKit SFU. |
| **Screenshare** | **Holo-Cast** | Screen or application broadcast within a Comm-Link Relay. |
| **Forum Channel** | **Archival Relay** | Thread-based asynchronous discussion board relay. |
| **Gallery Channel** | **Visual Relay** | Media-first gallery relay for image and video broadcasts. |
| **Category** | **Frequency Band** | An organizational grouping header containing multiple related Relays. |
| **Server Folder** | **Beacon Cluster** | A folder grouping multiple Beacons together in the user's Beacon navigation bar. |
| **Server List** | **Beacon List** | The vertical navigation bar displaying joined Beacons and Direct Link channels. |
| **Roles / Permissions** | **Clearances** | Hierarchical security rank and 64-bit Bitfield permission flags governing Beacon and Relay access. |
| **Direct Message (DM)** | **Point-to-Point Link** | 1-on-1 private transmission stream between two Transmitters. |
| **Group DM** | **Subspace Mesh** | Multi-transmitter private group stream outside of any Beacon. |
| **Friend Request** | **Affiliation Request** | A contact request with an optional transmission note. |
| **Message Request** | **Transmission Request** | A single-transmission request sent to non-affiliated Transmitters sharing a Beacon. |
| **Invisible Presence** | **Ghost Mode** | Masked presence state where the Transmitter appears strictly `offline` to all other peers. |
| **Admin Panel** | **Command Console** | Staff management dashboard for reports, drive files, custom badges, and instance telemetry. |
| **File Drive / Storage** | **Subspace Vault** | Personal cloud quota drive for storing, referencing, and managing uploaded attachments. |
| **Custom Emoji** | **Signal Glyphs** | Custom image-based emoji icons configured per Beacon or globally. |
| **Badges** | **Commendations** | Achievement markers awarded for account milestones, call duration, or staff duties. |
| **E2E Encryption** | **Quantum Encryption** | Zero-knowledge client-side encryption using Double Ratchet / Signal Protocol or WebRTC frame encryption. |

---

## Code Representation Standards

When naming variables, types, database tables, and API routes:
- Database tables use pluralized space terminology: `transmitters`, `beacons`, `relays`, `transmissions`, `clearances`.
- DTOs and API endpoints reflect the domain:
  - `POST /api/v1/transmissions`
  - `GET /api/v1/beacons/:id/relays`
  - `POST /api/v1/transmitters/@me/commendations/order`
- UI presentation text should always surface the Subspace Frequency term with tooltips where helpful for intuitive onboarding.

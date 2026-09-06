# Phase 7: Comm-Link Audio, Video & Holo-Cast

## 1. Overview & Objective
Phase 7 delivers real-time voice, video, and screensharing capabilities powered by a self-hosted **LiveKit SFU** server. It implements Comm-Link Relays, video calling, high-framerate Holo-Cast screensharing, participant state tracking, and the unique requirement of an **embedded text subchannel** accessible without requiring the user to join the active audio/video call.

---

## 2. Architectural Blueprint

```mermaid
flowchart TD
    subgraph Client["Transmitter Client"]
        AudioVideo["WebRTC Audio/Video/Screen"]
        SubchannelChat["Text Chat Component"]
    end

    subgraph Infrastructure["Media & Routing Infrastructure"]
        LiveKitSFU["LiveKit SFU (Port 7880 / WebSockets & UDP)"]
        API["apps/api-service (/comm-link/token)"]
        Gateway["apps/gateway-service (WebSocket / State)"]
    end

    Client -->|Request Room Token| API
    API -->|Signed LiveKit JWT| Client
    Client -->|WebRTC Media Stream| LiveKitSFU
    SubchannelChat -->|Direct Transmissions via WS (No Voice Join Needed)| Gateway
```

---

## 3. Detailed Component Specifications

### 3.1 LiveKit SFU Integration & Token Issuance
- **LiveKit Server**: Configured in `docker-compose.yml` using `livekit.yaml`.
- **JWT Token Generation**: Server endpoint `POST /relays/:id/comm-link/token` validates user clearance permissions (`PERMISSIONS.CONNECT_AUDIO`, `PERMISSIONS.SPEAK_AUDIO`, `PERMISSIONS.BROADCAST_HOLO_CAST`) and generates a signed LiveKit access token with specific grant scopes.

### 3.2 Comm-Link Audio & Video Streams
- Low-latency Opus audio codec with dynamic bitrate adaptation and noise suppression.
- VP8 / H.264 video publishing with adaptive simulcast layers for varying network speeds.

### 3.3 Holo-Cast (Screensharing)
- Screen capture track publishing with system audio capture.
- Configurable quality presets (720p 30fps, 1080p 60fps).

### 3.4 Embedded Text Subchannel
- Every Comm-Link Relay automatically provisions a paired text subchannel.
- **Key Requirement**: A Transmitter has full permission to read and send transmissions in the subchannel **without joining the voice/video call**.
- When joining the voice room, the client UI presents the video layout side-by-side or overlaid with the subchannel text chat.

---

## 4. Deliverables Matrix

| Deliverable | Description | File Path |
| :--- | :--- | :--- |
| **LiveKit Config** | Docker container & SFU networking settings | `docker/livekit.yaml` |
| **Media Auth Module**| Room token generation & WebRTC clearance grants | `apps/api-service/src/modules/media/livekit.ts` |
| **Comm-Link Routes** | Join tokens, active participant listing, disconnects | `apps/api-service/src/modules/media/comm-link.routes.ts` |
| **Subchannel Router**| Comm-Link embedded text message routing | `apps/api-service/src/modules/transmissions/subchannel.ts` |
| **Client Media Hooks**| WebRTC audio/video/screen state management | `packages/ui/src/media/useCommLink.ts` |

---

## 5. Verification & Acceptance Criteria

### Automated Verification
1. **Token Issuance Tests**:
   - User with `CONNECT_AUDIO` receives valid signed LiveKit JWT.
   - User without `CONNECT_AUDIO` receives `403 FORBIDDEN_CLEARANCE`.
   - User with `BROADCAST_HOLO_CAST` receives token containing `canPublishSources: ["screen_share"]`.
2. **Embedded Text Subchannel Tests**:
   - User sends transmission to Comm-Link subchannel without active LiveKit connection $\to$ succeeds and broadcasts via Gateway.

### Manual Acceptance Verification
- Open two browser instances, connect to Comm-Link, verify two-way audio and screenshare, and send messages in the embedded text subchannel from a third user who is not connected to voice.

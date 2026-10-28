import { signJwt } from '@subspace/crypto';
import { PERMISSIONS, hasPermission } from '@subspace/constants';

export interface LiveKitVideoGrants {
  roomJoin?: boolean;
  room?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishSources?: Array<'microphone' | 'camera' | 'screen_share' | 'screen_share_audio'>;
  canPublishData?: boolean;
  hidden?: boolean;
  recorder?: boolean;
}

export interface LiveKitTokenOptions {
  apiKey: string;
  apiSecret: string;
  identity: string; // transmitterId
  name: string; // displayName or username
  roomName: string; // relayId
  permissions: bigint;
  isOwner?: boolean;
  ttlSeconds?: number;
  /** A Stage's audience: listen only, until a moderator lets them speak. */
  audience?: boolean;
  /** Server mute (no microphone) and server deafen (hears nothing, and no microphone). */
  serverMuted?: boolean;
  serverDeafened?: boolean;
}

export type PublishSource = 'microphone' | 'camera' | 'screen_share' | 'screen_share_audio';

/**
 * What a member may send in a voice room, from their permissions there: Speak for the microphone
 * (not while server-muted or deafened, nor in a Stage's audience), Video for the camera, Holo-Cast
 * for screen sharing. The one place tokens, Stages and moderation decide it.
 */
export function publishSources(
  permissions: bigint,
  isOwner: boolean,
  opts: { audience?: boolean; serverMuted?: boolean; serverDeafened?: boolean } = {}
): PublishSource[] {
  if (opts.audience) return [];
  const has = (p: bigint) => isOwner || hasPermission(permissions, p);
  const out: PublishSource[] = [];
  if (has(PERMISSIONS.SPEAK_AUDIO) && !opts.serverMuted && !opts.serverDeafened) out.push('microphone');
  if (has(PERMISSIONS.BROADCAST_HOLO_CAST)) out.push('camera');
  if (has(PERMISSIONS.SHARE_SCREEN)) out.push('screen_share', 'screen_share_audio');
  return out;
}

/**
 * Generates an official LiveKit-compatible JWT access token
 * with granular track publishing grants mapped to Subspace Frequency Clearances
 */
export function createLiveKitAccessToken(options: LiveKitTokenOptions): string {
  const {
    apiKey,
    apiSecret,
    identity,
    name,
    roomName,
    permissions,
    isOwner = false,
    ttlSeconds = 6 * 3600, // 6 hours
    audience = false,
    serverMuted = false,
    serverDeafened = false,
  } = options;

  const canConnect = isOwner || hasPermission(permissions, PERMISSIONS.CONNECT_AUDIO);
  if (!canConnect) {
    throw new Error('Transmitter lacks CONNECT_AUDIO clearance');
  }

  const canPublishSources = publishSources(permissions, isOwner, { audience, serverMuted, serverDeafened });

  const videoGrant: LiveKitVideoGrants = {
    roomJoin: true,
    room: roomName,
    canPublish: canPublishSources.length > 0,
    canSubscribe: !serverDeafened,
    canPublishSources,
    // The client sends nothing over data channels; nobody needs to.
    canPublishData: false,
  };

  const payload = {
    iss: apiKey,
    sub: identity,
    name,
    video: videoGrant,
  };

  return signJwt(payload, apiSecret, {
    expiresIn: `${ttlSeconds}s`,
    notBefore: 0,
  });
}

/** LIVEKIT_FORCE_RELAY=true: clients send and receive media only through LiveKit's TURN server. */
export const forceRelay = () => process.env.LIVEKIT_FORCE_RELAY === 'true';

/** LiveKit's address from the API (LIVEKIT_INTERNAL_URL; default the compose service, or 127.0.0.1:7880 outside production). */
const roomServiceBase = () =>
  (process.env.LIVEKIT_INTERNAL_URL || (process.env.NODE_ENV === 'production' ? 'http://livekit:7880' : 'http://127.0.0.1:7880')).replace(/^ws/, 'http').replace(/\/$/, '');

/** LiveKit's RoomService (Twirp over HTTP), called with a room-admin token we sign ourselves. */
async function roomService(opts: { apiKey: string; apiSecret: string; room: string }, method: string, body: unknown): Promise<boolean> {
  const admin = signJwt({ iss: opts.apiKey, sub: 'subspace-api', video: { roomAdmin: true, room: opts.room } }, opts.apiSecret, { expiresIn: '60s', notBefore: 0 });
  try {
    const res = await fetch(`${roomServiceBase()}/twirp/livekit.RoomService/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Change what a connected participant may do without reconnecting them: Stages promote and
 * demote speakers this way, and server mute and deafen take effect at once.
 */
export async function updateLiveKitParticipant(opts: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  /** From publishSources(). */
  sources: PublishSource[];
  serverDeafened?: boolean;
}): Promise<boolean> {
  const sources = opts.sources.map((s) => s.toUpperCase());
  return roomService(opts, 'UpdateParticipant', {
    room: opts.room,
    identity: opts.identity,
    permission: { can_subscribe: !opts.serverDeafened, can_publish: sources.length > 0, can_publish_data: false, can_publish_sources: sources },
  });
}

/** Drop a participant from a room (disconnect or move): their media stops at once. */
export const removeLiveKitParticipant = (opts: { apiKey: string; apiSecret: string; room: string; identity: string }) =>
  roomService(opts, 'RemoveParticipant', { room: opts.room, identity: opts.identity });

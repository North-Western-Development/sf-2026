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
  } = options;

  const canConnect = isOwner || hasPermission(permissions, PERMISSIONS.CONNECT_AUDIO);
  if (!canConnect) {
    throw new Error('Transmitter lacks CONNECT_AUDIO clearance');
  }

  const canSpeak = !audience && (isOwner || hasPermission(permissions, PERMISSIONS.SPEAK_AUDIO));
  const canHoloCast = !audience && (isOwner || hasPermission(permissions, PERMISSIONS.BROADCAST_HOLO_CAST));

  const canPublishSources: Array<'microphone' | 'camera' | 'screen_share' | 'screen_share_audio'> = [];

  if (canSpeak) {
    canPublishSources.push('microphone');
  }

  if (canHoloCast) {
    canPublishSources.push('camera', 'screen_share', 'screen_share_audio');
  }

  const videoGrant: LiveKitVideoGrants = {
    roomJoin: true,
    room: roomName,
    canPublish: canSpeak || canHoloCast,
    canSubscribe: true,
    canPublishSources,
    canPublishData: true,
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

/**
 * LiveKit's RoomService (Twirp over HTTP), called with a room-admin token we sign ourselves:
 * used by Stages to let a member speak or move them back to the audience without reconnecting.
 * LIVEKIT_INTERNAL_URL is LiveKit's address from the API (default: the compose service, or
 * 127.0.0.1:7880 outside production).
 */
export async function updateLiveKitParticipant(opts: { apiKey: string; apiSecret: string; room: string; identity: string; canSpeak: boolean; canHoloCast: boolean }): Promise<boolean> {
  const base = (process.env.LIVEKIT_INTERNAL_URL || (process.env.NODE_ENV === 'production' ? 'http://livekit:7880' : 'http://127.0.0.1:7880')).replace(/^ws/, 'http').replace(/\/$/, '');
  const admin = signJwt({ iss: opts.apiKey, sub: 'subspace-api', video: { roomAdmin: true, room: opts.room } }, opts.apiSecret, { expiresIn: '60s', notBefore: 0 });
  const sources: string[] = [];
  if (opts.canSpeak) sources.push('MICROPHONE');
  if (opts.canSpeak && opts.canHoloCast) sources.push('CAMERA', 'SCREEN_SHARE', 'SCREEN_SHARE_AUDIO');
  try {
    const res = await fetch(`${base}/twirp/livekit.RoomService/UpdateParticipant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({
        room: opts.room,
        identity: opts.identity,
        permission: { can_subscribe: true, can_publish: sources.length > 0, can_publish_data: true, can_publish_sources: sources },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

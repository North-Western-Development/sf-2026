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
  } = options;

  const canConnect = isOwner || hasPermission(permissions, PERMISSIONS.CONNECT_AUDIO);
  if (!canConnect) {
    throw new Error('Transmitter lacks CONNECT_AUDIO clearance');
  }

  const canSpeak = isOwner || hasPermission(permissions, PERMISSIONS.SPEAK_AUDIO);
  const canHoloCast = isOwner || hasPermission(permissions, PERMISSIONS.BROADCAST_HOLO_CAST);

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

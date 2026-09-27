/**
 * Canonical Space-Themed Lexicon mapping
 */
export const TERMINOLOGY = {
  USER: 'Transmitter',
  MESSAGE: 'Transmission',
  SERVER: 'Beacon',
  CHANNEL: 'Relay',
  TEXT_CHANNEL: 'Text Relay',
  VOICE_CHANNEL: 'Comm-Link Relay',
  SCREENSHARE: 'Holo-Cast',
  FORUM_CHANNEL: 'Archival Relay',
  GALLERY_CHANNEL: 'Visual Relay',
  CATEGORY: 'Frequency Band',
  SERVER_FOLDER: 'Beacon Cluster',
  SERVER_LIST: 'Beacon List',
  ROLES: 'Clearances',
  DIRECT_MESSAGE: 'Point-to-Point Link',
  GROUP_DM: 'Subspace Mesh',
  FRIEND_REQUEST: 'Affiliation Request',
  MESSAGE_REQUEST: 'Transmission Request',
  INVISIBLE_PRESENCE: 'Ghost Mode',
  ADMIN_PANEL: 'Command Console',
  FILE_DRIVE: 'Subspace Vault',
  CUSTOM_EMOJI: 'Signal Glyphs',
  BADGES: 'Commendations',
  E2E_ENCRYPTION: 'Quantum Encryption',
} as const;

/**
 * 64-bit Bitfield Permissions for Clearances
 */
export const PERMISSIONS = {
  NONE: 0n,
  VIEW_RELAY: 1n << 0n,              // 0x1 - Access and view the relay
  SEND_TRANSMISSIONS: 1n << 1n,      // 0x2 - Post transmissions in text/archival
  EMBED_LINKS: 1n << 2n,             // 0x4 - Unfurl rich links
  ATTACH_FILES: 1n << 3n,            // 0x8 - Upload/attach files
  USE_SIGNAL_GLYPHS: 1n << 4n,       // 0x10 - Use custom emojis
  CONNECT_AUDIO: 1n << 5n,           // 0x20 - Join Comm-Link audio rooms
  SPEAK_AUDIO: 1n << 6n,             // 0x40 - Speak in Comm-Link audio rooms
  BROADCAST_HOLO_CAST: 1n << 7n,     // 0x80 - Screenshare/camera in Comm-Link
  MANAGE_TRANSMISSIONS: 1n << 8n,    // 0x100 - Delete/pin other transmissions
  MANAGE_RELAYS: 1n << 9n,           // 0x200 - Create, edit, delete relays
  MANAGE_CLEARANCES: 1n << 10n,      // 0x400 - Create, edit, assign clearances below own
  KICK_MEMBERS: 1n << 11n,           // 0x800 - Kick members below own rank
  BAN_MEMBERS: 1n << 12n,            // 0x1000 - Ban members below own rank
  ADMINISTRATOR: 1n << 29n,          // 0x20000000 - Bypass all relay permission checks
} as const;

export type PermissionBit = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Helper to test if a bitfield has a specific permission or administrator
 */
export function hasPermission(bitfield: bigint, permission: bigint): boolean {
  if ((bitfield & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) {
    return true;
  }
  return (bitfield & permission) === permission;
}

/**
 * Standard default permissions for @everyone clearance in newly established Beacons
 */
export const DEFAULT_EVERYONE_PERMISSIONS =
  PERMISSIONS.VIEW_RELAY |
  PERMISSIONS.SEND_TRANSMISSIONS |
  PERMISSIONS.EMBED_LINKS |
  PERMISSIONS.ATTACH_FILES |
  PERMISSIONS.CONNECT_AUDIO |
  PERMISSIONS.SPEAK_AUDIO;

/**
 * Calculate the effective permission bitfield for a member given their clearances and owner status
 */
export function computeMemberPermissions(
  clearances: Array<{ permissions: bigint | string | number }>,
  isOwner: boolean = false
): bigint {
  if (isOwner) {
    return PERMISSIONS.ADMINISTRATOR;
  }
  let total = 0n;
  for (const clearance of clearances) {
    total |= BigInt(clearance.permissions);
  }
  return total;
}

/**
 * Compute the highest hierarchy position for a member.
 * Beacon owners always have highest possible rank (Infinity / 999999).
 */
export function getHighestRank(
  clearances: Array<{ position: number }>,
  isOwner: boolean = false
): number {
  if (isOwner) {
    return 999999;
  }
  if (!clearances || clearances.length === 0) {
    return 0; // Baseline @everyone position
  }
  return Math.max(...clearances.map((c) => c.position));
}

/**
 * Checks if actor has strict authority over target according to clearance hierarchy
 */
export function canModerate(
  actorRank: number,
  targetRank: number,
  isActorOwner: boolean = false,
  isTargetOwner: boolean = false
): boolean {
  if (isTargetOwner) {
    return false; // Nobody can moderate the owner
  }
  if (isActorOwner) {
    return true; // Owner can moderate everyone except another owner (which doesn't exist)
  }
  return actorRank > targetRank;
}

/**
 * 5 Presence States
 */
export const PRESENCE_STATES = {
  ONLINE: 'online',
  IDLE: 'idle',
  AWAY: 'away',
  INVISIBLE: 'invisible',
  OFFLINE: 'offline',
} as const;

export type PresenceState = typeof PRESENCE_STATES[keyof typeof PRESENCE_STATES];

/**
 * Relay Channel Types
 */
export const RELAY_TYPES = {
  TEXT: 'text',
  COMM_LINK: 'comm_link',
  ARCHIVAL: 'archival',
  VISUAL: 'visual',
} as const;

export type RelayType = typeof RELAY_TYPES[keyof typeof RELAY_TYPES];

/**
 * Staff Clearance Levels for Command Console
 */
export const STAFF_RANKS = {
  NONE: 0,
  MODERATOR: 1,
  ADMIN: 2,
  ROOT: 3,
} as const;

export type StaffRank = typeof STAFF_RANKS[keyof typeof STAFF_RANKS];

/**
 * Gateway Opcodes for WebSocket payloads
 */
export const GATEWAY_OPCODES = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

export type GatewayOpcode = typeof GATEWAY_OPCODES[keyof typeof GATEWAY_OPCODES];

/**
 * Subspace Directives: the instance rules every transmitter must accept.
 * Bump `version` whenever the text changes so existing accounts are re-prompted.
 */
export const SUBSPACE_DIRECTIVES = {
  version: 1,
  rules: [
    { title: 'Respect every transmitter', body: 'No harassment, hate speech, threats, or targeted abuse.' },
    { title: 'Keep it legal', body: 'Do not share illegal content or coordinate illegal activity.' },
    { title: 'No spam or impersonation', body: 'No unsolicited advertising, scams, or pretending to be someone else, including staff.' },
    { title: 'Protect privacy', body: "Do not share other people's personal information without consent." },
    { title: 'Uploads are not private', body: 'Anyone with a file link, and instance staff, can open uploaded files.' },
    { title: 'Command Staff decisions apply', body: 'Staff may remove content or suspend accounts that break these directives.' },
  ],
} as const;

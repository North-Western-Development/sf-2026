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
  ADD_REACTIONS: 1n << 13n,          // Add new reactions (existing ones need only VIEW_RELAY)
  MENTION_EVERYONE: 1n << 14n,       // @everyone, @here, non-mentionable clearance pings
  CREATE_INVITES: 1n << 15n,         // Create beacon invites
  MANAGE_BEACON: 1n << 16n,          // Edit beacon settings, view/revoke all invites
  CHANGE_NICKNAME: 1n << 17n,        // Change own nickname
  MANAGE_NICKNAMES: 1n << 18n,       // Change others' nicknames (hierarchy applies)
  READ_HISTORY: 1n << 19n,           // Read transmissions sent before the member could see the relay
  MANAGE_GLYPHS: 1n << 20n,          // Create/rename/delete Signal Glyphs
  MUTE_MEMBERS: 1n << 21n,           // Server-mute members in Comm-Links
  MOVE_MEMBERS: 1n << 22n,           // Move/disconnect members in Comm-Links
  PIN_TRANSMISSIONS: 1n << 23n,      // Pin/unpin transmissions
  CREATE_EVENTS: 1n << 24n,          // Schedule events; edit or cancel your own
  MANAGE_EVENTS: 1n << 25n,          // Edit, start, end or cancel anyone's events
  MODERATE_MEMBERS: 1n << 26n,       // Time out members below own rank
  VIEW_AUDIT_LOG: 1n << 27n,         // Read the beacon's audit log
  USE_SOUNDBOARD: 1n << 28n,         // Play soundboard sounds in Comm-Links
  CREATE_THREADS: 1n << 30n,         // Start threads from transmissions
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
  PERMISSIONS.SPEAK_AUDIO |
  PERMISSIONS.ADD_REACTIONS |
  PERMISSIONS.CREATE_INVITES |
  PERMISSIONS.CHANGE_NICKNAME |
  PERMISSIONS.READ_HISTORY |
  PERMISSIONS.USE_SOUNDBOARD |
  PERMISSIONS.CREATE_THREADS;

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
  DND: 'dnd',
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
 * Media upload purposes and their limits (section 7 of the parity contract).
 * Object keys are `<purpose>/<uuid>.<ext>` in the public-read `subspace-media` bucket.
 */
export const MEDIA_PURPOSES = {
  avatar: { maxBytes: 8 * 1024 * 1024 },
  banner: { maxBytes: 10 * 1024 * 1024 },
  beacon_icon: { maxBytes: 8 * 1024 * 1024 },
  beacon_banner: { maxBytes: 10 * 1024 * 1024 },
  glyph: { maxBytes: 256 * 1024 },
  mesh_icon: { maxBytes: 8 * 1024 * 1024 },
} as const;

export type MediaPurpose = keyof typeof MEDIA_PURPOSES;

export const MEDIA_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export const MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Discord-parity username rule (section 9): 2-32 chars, lowercase letters/digits/underscore/period,
 * no consecutive periods, cannot start or end with a period.
 */
export const USERNAME_REGEX = /^[a-z0-9_.]{2,32}$/;

export function isValidUsername(username: string): boolean {
  if (!USERNAME_REGEX.test(username)) return false;
  if (username.startsWith('.') || username.endsWith('.')) return false;
  if (username.includes('..')) return false;
  return true;
}

export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const DISPLAY_NAME_STYLE_FONTS = ['default', 'orbitron', 'rajdhani', 'space_grotesk', 'jetbrains'] as const;
export const DISPLAY_NAME_STYLE_EFFECTS = ['solid', 'gradient', 'neon', 'toon', 'pop'] as const;

export const PROFILE_VISIBILITY_LEVELS = ['everyone', 'beacons', 'friends'] as const;
export type ProfileVisibility = typeof PROFILE_VISIBILITY_LEVELS[number];

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

/**
 * What a timed-out member (or a quarantined account) loses in a beacon: anything that posts,
 * reacts, speaks or invites. They can still read.
 */
export const RESTRICTED_MASK =
  PERMISSIONS.SEND_TRANSMISSIONS |
  PERMISSIONS.ATTACH_FILES |
  PERMISSIONS.EMBED_LINKS |
  PERMISSIONS.ADD_REACTIONS |
  PERMISSIONS.USE_SIGNAL_GLYPHS |
  PERMISSIONS.CONNECT_AUDIO |
  PERMISSIONS.SPEAK_AUDIO |
  PERMISSIONS.BROADCAST_HOLO_CAST |
  PERMISSIONS.CREATE_INVITES |
  PERMISSIONS.CHANGE_NICKNAME |
  PERMISSIONS.CREATE_EVENTS |
  PERMISSIONS.USE_SOUNDBOARD |
  PERMISSIONS.CREATE_THREADS;

/** Applies a timeout or quarantine to a permission set. Administrators are never restricted (they cannot be timed out). */
export function restrictPermissions(
  perms: bigint,
  restriction: { timeoutUntil?: Date | string | null; quarantined?: boolean; unverified?: boolean },
  now = Date.now()
): bigint {
  if ((perms & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) return perms;
  const timedOut = !!restriction.timeoutUntil && new Date(restriction.timeoutUntil).getTime() > now;
  return timedOut || restriction.quarantined || restriction.unverified ? perms & ~RESTRICTED_MASK : perms;
}

export type VerificationLevel = 'none' | 'low' | 'medium' | 'high' | 'highest';

/**
 * Safety Setup's verification level (Discord's): until a member meets it they can read but not
 * post, react or speak. Members with any clearance are exempt, as on Discord.
 *   low: verified email; medium: and an account older than 5 minutes; high: and a member for
 *   10 minutes; highest: and two-factor authentication on (Discord asks for a phone).
 */
export function meetsVerification(
  level: string | null | undefined,
  account: { isEmailVerified: boolean; createdAt: Date | string | number; is2faEnabled: boolean },
  member: { joinedAt: Date | string | number; hasClearance: boolean },
  now = Date.now()
): boolean {
  if (!level || level === 'none' || member.hasClearance) return true;
  if (!account.isEmailVerified) return false;
  if (level === 'low') return true;
  if (now - new Date(account.createdAt).getTime() < 5 * 60_000) return false;
  if (level === 'medium') return true;
  if (now - new Date(member.joinedAt).getTime() < 10 * 60_000) return false;
  if (level === 'high') return true;
  return account.is2faEnabled;
}

/** Timeout lengths offered, in seconds (Discord's set). */
export const TIMEOUT_DURATIONS = [60, 300, 600, 3600, 86400, 604800] as const;

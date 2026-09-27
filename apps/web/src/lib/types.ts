// Domain types for the web client. Mirrors docs/api/parity-contract.md.

export type Presence = 'online' | 'idle' | 'dnd' | 'away' | 'invisible' | 'offline';

export type ChannelType = 'relay' | 'link' | 'mesh' | 'thread';
/** Stable key for a message container, e.g. `relay:<uuid>`. */
export type ChannelKey = `${ChannelType}:${string}`;
export const channelKey = (type: ChannelType, id: string): ChannelKey => `${type}:${id}`;
export const parseChannelKey = (key: ChannelKey) => {
  const i = key.indexOf(':');
  return { type: key.slice(0, i) as ChannelType, id: key.slice(i + 1) };
};

export type RelayKind = 'text' | 'comm_link' | 'archival' | 'visual' | 'category';

export interface DisplayNameStyle {
  font: string;
  effect: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
  colors: string[];
}

export interface CustomStatus {
  text?: string;
  emoji?: string;
  expiresAt?: string | null;
}

/** Author / user reference shape used across messages, members and relationships. */
export interface UserRef {
  id: string;
  username: string;
  discriminator: string;
  displayName: string | null;
  avatarUrl: string | null;
  displayColor?: string | null;
  displayFont?: string | null;
  displayNameStyle?: DisplayNameStyle | null;
  staffRank?: number;
}

export interface SelfUser extends UserRef {
  email: string;
  bio: string | null;
  pronouns?: string | null;
  bannerUrl: string | null;
  bannerColor: string | null;
  themePrimary?: string | null;
  themeAccent?: string | null;
  customStatus?: CustomStatus | null;
  is2faEnabled?: boolean;
  createdAt?: string;
}

export interface Beacon {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  ownerId: string;
  isDiscoverable: boolean;
  suppressCustomFonts?: boolean;
  rulesText?: string | null;
  memberCount?: number;
}

export interface Relay {
  id: string;
  beaconId: string;
  parentId: string | null;
  name: string;
  type: RelayKind;
  topic: string | null;
  position: number;
  isUnhideable: boolean;
  isHidden?: boolean;
  /** Decimal-string bitfield of the viewer's effective permissions. */
  myPermissions?: string;
  lastTransmissionId?: string | null;
}

export interface Clearance {
  id: string;
  beaconId: string;
  name: string;
  color: string;
  position: number;
  permissions: string;
  hoist: boolean;
  allowDelegation?: boolean;
}

export interface Member {
  transmitterId: string;
  beaconId: string;
  user: UserRef;
  nickname: string | null;
  clearanceIds: string[];
  joinedAt?: string;
  isOwner?: boolean;
  avatarUrl?: string | null;
}

export interface Attachment {
  id: string;
  url: string;
  filename: string;
  size: number;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  me: boolean;
  glyph?: { id: string; name: string; url: string };
}

export interface ReplyPreview {
  id: string;
  author: UserRef | null;
  content: string;
  attachmentsCount: number;
  deleted: boolean;
}

export interface Transmission {
  id: string;
  channelType: ChannelType;
  channelId: string;
  author: UserRef;
  member?: { nickname: string | null; clearanceIds: string[]; color: string | null } | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  attachments: Attachment[];
  mentions: string[];
  mentionRoles: string[];
  mentionEveryone: boolean;
  replyTo: ReplyPreview | null;
  reactions: ReactionSummary[];
  pinned: boolean;
  type: 'default' | 'reply' | 'system_join' | 'system_pin';
  /** Client-only: optimistic send state. */
  pending?: boolean;
  failed?: boolean;
  nonce?: string;
}

export interface ReadState {
  lastReadId: string | null;
  lastReadAt: string | null;
  mentionCount: number;
}

export interface ChannelActivity {
  lastId: string | null;
  lastAt: string | null;
  beaconId?: string;
}

export type NotificationLevel = 'all' | 'mentions' | 'nothing' | 'inherit';
export type NotificationScope = 'global' | 'beacon' | 'category' | 'relay' | 'link' | 'mesh';

export interface NotificationSetting {
  scopeType: NotificationScope;
  scopeId: string;
  level: NotificationLevel;
  mutedUntil: string | null;
  suppressEveryone: boolean;
  suppressRoles: boolean;
  suppressHighlights: boolean;
  mobilePush: boolean;
}

export type RelationshipType = 'friend' | 'incoming' | 'outgoing' | 'blocked';
export interface Relationship {
  id: string;
  type: RelationshipType;
  user: UserRef;
  note?: string | null;
  since?: string;
}

export interface DirectLink {
  id: string;
  recipient: UserRef;
  lastTransmissionId: string | null;
  lastTransmissionAt: string | null;
}

export interface Mesh {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  members: UserRef[];
  lastTransmissionId?: string | null;
  lastTransmissionAt: string | null;
}

export interface Cluster {
  id: string;
  name: string;
  color: string;
  position: number;
  beaconIds: string[];
}

export interface VoiceState {
  transmitterId: string;
  username: string;
  relayId: string;
  beaconId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
}

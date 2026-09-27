// Map API payloads (legacy and contract shapes) into client domain types.
import type {
  Beacon,
  ChannelType,
  Clearance,
  Cluster,
  DirectLink,
  Member,
  Mesh,
  Relationship,
  Relay,
  RelayKind,
  Transmission,
  UserRef,
} from './types';

type Raw = Record<string, any>;

export function toUserRef(raw: Raw | null | undefined, fallbackId = ''): UserRef {
  const r = raw ?? {};
  return {
    id: r.id ?? r.transmitterId ?? fallbackId,
    username: r.username ?? 'unknown',
    discriminator: r.discriminator ?? '0000',
    displayName: r.displayName ?? null,
    avatarUrl: r.avatarUrl ?? null,
    displayColor: r.displayColor ?? null,
    displayFont: r.displayFont ?? null,
    displayNameStyle: r.displayNameStyle ?? null,
    staffRank: r.staffRank ?? 0,
  };
}

const RELAY_KINDS: Record<string, RelayKind> = {
  text: 'text',
  announcement: 'text',
  voice: 'comm_link',
  comm_link: 'comm_link',
  archival: 'archival',
  archive: 'archival',
  forum: 'archival',
  visual: 'visual',
  gallery: 'visual',
  category: 'category',
};

export function toRelay(r: Raw): Relay {
  return {
    id: r.id,
    beaconId: r.beaconId,
    parentId: r.parentId ?? null,
    name: r.name,
    type: RELAY_KINDS[r.type] ?? 'text',
    topic: r.topic ?? null,
    position: r.position ?? 0,
    isUnhideable: !!r.isUnhideable,
    isHidden: !!r.isHidden,
    myPermissions: r.myPermissions,
    lastTransmissionId: r.lastTransmissionId ?? null,
  };
}

export function toBeacon(b: Raw): Beacon {
  return {
    id: b.id,
    name: b.name,
    description: b.description ?? null,
    iconUrl: b.iconUrl ?? null,
    bannerUrl: b.bannerUrl ?? null,
    ownerId: b.ownerId,
    isDiscoverable: !!b.isDiscoverable,
    suppressCustomFonts: !!b.suppressCustomFonts,
    rulesText: b.rulesText ?? null,
    memberCount: b.memberCount,
  };
}

export function toClearance(c: Raw): Clearance {
  return {
    id: c.id,
    beaconId: c.beaconId,
    name: c.name,
    color: c.color ?? '#99AAB5',
    position: c.position ?? 0,
    permissions: String(c.permissions ?? '0'),
    hoist: !!c.hoist,
    allowDelegation: !!c.allowDelegation,
  };
}

export function toMember(m: Raw, beaconId: string): Member {
  const user = toUserRef(m.user ?? m, m.transmitterId);
  return {
    transmitterId: m.transmitterId ?? user.id,
    beaconId,
    user,
    nickname: m.nickname ?? null,
    clearanceIds: m.clearanceIds ?? [],
    joinedAt: m.joinedAt,
    isOwner: !!m.isOwner,
    avatarUrl: m.member?.avatarUrl ?? null,
  };
}

function inferChannel(t: Raw): { channelType: ChannelType; channelId: string } {
  if (t.channelType && t.channelId) return { channelType: t.channelType, channelId: t.channelId };
  if (t.threadId) return { channelType: 'thread', channelId: t.threadId };
  if (t.relayId) return { channelType: 'relay', channelId: t.relayId };
  if (t.meshId) return { channelType: 'mesh', channelId: t.meshId };
  if (t.p2pLinkId) return { channelType: 'link', channelId: t.p2pLinkId };
  return { channelType: 'relay', channelId: '' };
}

export function toTransmission(t: Raw): Transmission {
  const author = toUserRef(
    t.author ?? {
      id: t.transmitterId ?? t.authorId,
      username: t.authorUsername,
      displayName: t.authorName,
      avatarUrl: t.authorAvatar,
    },
    t.transmitterId ?? t.authorId
  );
  return {
    id: t.id,
    ...inferChannel(t),
    author,
    member: t.member ?? null,
    content: t.content ?? '',
    createdAt: t.createdAt,
    editedAt: t.editedAt ?? (t.isEdited ? t.updatedAt : null) ?? null,
    attachments: Array.isArray(t.attachments) ? t.attachments : [],
    mentions: t.mentions ?? [],
    mentionRoles: t.mentionRoles ?? [],
    mentionEveryone: !!t.mentionEveryone,
    replyTo: t.replyTo ?? null,
    reactions: t.reactions ?? [],
    pinned: !!(t.pinned ?? t.isPinned),
    type: t.type ?? (t.replyTo ? 'reply' : 'default'),
    nonce: t.nonce,
  };
}

export function toCluster(c: Raw): Cluster {
  return {
    id: c.id,
    name: c.name,
    color: c.color ?? '#3B8EF2',
    position: c.position ?? 0,
    beaconIds: c.beaconIds ?? [],
  };
}

export function toLink(l: Raw, selfId: string): DirectLink {
  const recipientRaw =
    l.recipient ??
    (l.transmitter1Id === selfId ? l.transmitter2 ?? { id: l.transmitter2Id } : l.transmitter1 ?? { id: l.transmitter1Id }) ??
    l.partner;
  return {
    id: l.id,
    recipient: toUserRef(recipientRaw),
    lastTransmissionId: l.lastTransmissionId ?? null,
    lastTransmissionAt: l.lastTransmissionAt ?? l.updatedAt ?? null,
  };
}

export function toMesh(m: Raw): Mesh {
  return {
    id: m.id,
    name: m.name,
    iconUrl: m.iconUrl ?? null,
    ownerId: m.ownerId,
    members: (m.members ?? []).map((u: Raw) => toUserRef(u)),
    lastTransmissionId: m.lastTransmissionId ?? null,
    lastTransmissionAt: m.lastTransmissionAt ?? m.updatedAt ?? null,
  };
}

export function toRelationships(raw: Raw, selfId: string): Relationship[] {
  if (Array.isArray(raw.relationships)) {
    return raw.relationships.map((r: Raw) => ({
      id: r.id,
      type: r.type,
      user: toUserRef(r.user),
      note: r.note ?? null,
      since: r.since,
    }));
  }
  // Legacy: { affiliations: [...] } rows with transmitterId/targetId/status and optional profiles.
  const rows: Raw[] = raw.affiliations ?? raw.friends ?? [];
  return rows.map((a) => {
    const outgoing = a.transmitterId === selfId;
    const other = outgoing ? a.target ?? { id: a.targetId } : a.transmitter ?? a.sender ?? { id: a.transmitterId };
    const type = a.status === 'accepted' ? 'friend' : outgoing ? 'outgoing' : 'incoming';
    return { id: a.id, type, user: toUserRef(other), note: a.greetingNote ?? null, since: a.updatedAt };
  });
}

/** Resolved display name inside a beacon: nickname → display name → username. */
export function resolveName(user: UserRef, member?: { nickname: string | null } | null): string {
  return member?.nickname || user.displayName || user.username;
}

export const userTag = (u: Pick<UserRef, 'username' | 'discriminator'>) => `${u.username}#${u.discriminator}`;

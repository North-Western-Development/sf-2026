import {
  eq,
  and,
  inArray,
  transmissions,
  transmitters,
  beaconMembers,
  clearances,
  beaconEmojis,
  transmissionReactions,
} from '@subspace/database';
import { ChannelType } from './channels.js';

export const AUTHOR_FIELDS = {
  id: transmitters.id,
  username: transmitters.username,
  discriminator: transmitters.discriminator,
  displayName: transmitters.displayName,
  avatarUrl: transmitters.avatarUrl,
  displayColor: transmitters.displayColor,
  displayFont: transmitters.displayFont,
  staffRank: transmitters.staffRank,
  /** The beacon whose tag they wear; clients look up the tag itself. */
  tagBeaconId: transmitters.tagBeaconId,
  avatarDecoration: transmitters.avatarDecoration,
};

export function deriveChannel(row: {
  relayId?: string | null;
  threadId?: string | null;
  p2pLinkId?: string | null;
  meshId?: string | null;
}): { channelType: ChannelType; channelId: string } | null {
  if (row.threadId) return { channelType: 'thread', channelId: row.threadId };
  if (row.relayId) return { channelType: 'relay', channelId: row.relayId };
  if (row.p2pLinkId) return { channelType: 'link', channelId: row.p2pLinkId };
  if (row.meshId) return { channelType: 'mesh', channelId: row.meshId };
  return null;
}

export async function fetchAuthorProfile(db: any, transmitterId: string) {
  const [profile] = await db.select(AUTHOR_FIELDS).from(transmitters).where(eq(transmitters.id, transmitterId)).limit(1);
  return profile || null;
}

/** Highest-colored clearance for a beacon member, matching the beacon member-list resolution. */
export function resolveMemberColor(
  memberClearanceIds: string[],
  beaconClearances: Array<typeof clearances.$inferSelect>,
  fallbackColor: string
): string {
  const map = new Map(beaconClearances.map((c) => [c.id, c]));
  const owned = (memberClearanceIds || [])
    .map((id) => map.get(id))
    .filter(Boolean) as Array<typeof clearances.$inferSelect>;
  owned.sort((a, b) => b.position - a.position);
  const highestColored = owned.find((c) => c.color && c.color !== '#99AAB5');
  return highestColored ? highestColored.color : fallbackColor;
}

export async function buildReplyPreview(db: any, replyToId: string | null) {
  if (!replyToId) return null;
  const [parent] = await db.select().from(transmissions).where(eq(transmissions.id, replyToId)).limit(1);
  if (!parent) return { id: replyToId, author: null, content: '', attachmentsCount: 0, deleted: true };
  const author = await fetchAuthorProfile(db, parent.transmitterId);
  return {
    id: parent.id,
    author,
    content: (parent.content || '').slice(0, 200),
    attachmentsCount: Array.isArray(parent.attachments) ? parent.attachments.length : 0,
    deleted: false,
  };
}

export async function buildReactions(db: any, transmissionId: string, callerId: string) {
  const rows: Array<typeof transmissionReactions.$inferSelect> = await db
    .select()
    .from(transmissionReactions)
    .where(eq(transmissionReactions.transmissionId, transmissionId));

  const byEmoji = new Map<string, { count: number; me: boolean }>();
  for (const r of rows) {
    const entry = byEmoji.get(r.emojiKey) || { count: 0, me: false };
    entry.count += 1;
    if (r.transmitterId === callerId) entry.me = true;
    byEmoji.set(r.emojiKey, entry);
  }

  const glyphIds = [...byEmoji.keys()].filter((k) => k.startsWith('custom:')).map((k) => k.slice('custom:'.length));
  const glyphs: any[] = glyphIds.length
    ? await db.select().from(beaconEmojis).where(inArray(beaconEmojis.id, glyphIds))
    : [];
  const glyphMap = new Map<string, any>(glyphs.map((g) => [g.id, g]));

  return [...byEmoji.entries()].map(([emoji, { count, me }]) => {
    if (emoji.startsWith('custom:')) {
      const glyphId = emoji.slice('custom:'.length);
      const glyph = glyphMap.get(glyphId);
      return { emoji, count, me, glyph: glyph ? { id: glyph.id, name: glyph.name, url: glyph.url } : null };
    }
    return { emoji, count, me };
  });
}

/**
 * Formats a transmission row into the shared `Transmission` shape used across every
 * channel type. `callerId` scopes reaction `me` flags; `beaconId`/`beaconClearances`
 * are only supplied for relay/thread channels (for the `member` block).
 */
export async function formatTransmission(
  db: any,
  row: typeof transmissions.$inferSelect,
  callerId: string,
  ctx: { beaconId?: string } = {}
) {
  const channel = deriveChannel(row);
  const author = await fetchAuthorProfile(db, row.transmitterId);

  let member: { nickname: string | null; clearanceIds: string[]; color: string } | undefined;
  if (ctx.beaconId) {
    const [memberRow] = await db
      .select()
      .from(beaconMembers)
      .where(and(eq(beaconMembers.transmitterId, row.transmitterId), eq(beaconMembers.beaconId, ctx.beaconId)))
      .limit(1);
    if (memberRow) {
      const beaconClearances = await db.select().from(clearances).where(eq(clearances.beaconId, ctx.beaconId));
      member = {
        nickname: memberRow.nickname,
        clearanceIds: memberRow.clearanceIds || [],
        color: resolveMemberColor(memberRow.clearanceIds || [], beaconClearances, author?.displayColor || '#00F0FF'),
      };
    }
  }

  const replyTo = await buildReplyPreview(db, row.replyToId || null);
  const reactions = await buildReactions(db, row.id, callerId);

  return {
    id: row.id,
    channelType: channel?.channelType,
    channelId: channel?.channelId,
    relayId: row.relayId,
    threadId: row.threadId,
    p2pLinkId: row.p2pLinkId,
    meshId: row.meshId,
    author,
    member,
    content: row.content,
    createdAt: row.createdAt,
    editedAt: row.isEdited ? row.updatedAt : null,
    attachments: row.attachments || [],
    stickers: (row as any).stickers || [],
    forwarded: (row as any).forwarded ?? null,
    mentions: row.mentions || [],
    mentionRoles: row.mentionRoles || [],
    mentionEveryone: !!row.mentionEveryone,
    replyTo,
    reactions,
    pinned: !!row.pinnedAt,
    embeds: row.suppressEmbeds ? [] : (row as any).embeds || [],
    // End-to-end encrypted links: ciphertext only, for the clients to open.
    encrypted: row.encryptedPayload ? JSON.parse(row.encryptedPayload) : null,
    suppressEmbeds: !!(row as any).suppressEmbeds,
    type: row.type || 'default',
  };
}

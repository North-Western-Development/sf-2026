import { eq, inArray, beaconEmojis, beaconMembers } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';

/**
 * Who may use a glyph or sticker where (Discord's rules):
 *   in a beacon's relay   its own with Use Signal Glyphs; another beacon's with Use External
 *                         Glyphs (or Use External Stickers), from a beacon the sender is in
 *   in a DM or mesh       any from a beacon the sender is in
 */
export function expressionAllowed(
  item: { beaconId: string },
  where: { beaconId?: string | null; perms: bigint | null },
  memberOf: Set<string>,
  kind: 'glyph' | 'sticker'
): boolean {
  if (!memberOf.has(item.beaconId)) return false;
  if (!where.beaconId || where.perms === null) return true;
  if (item.beaconId === where.beaconId) return kind === 'sticker' || hasPermission(where.perms, PERMISSIONS.USE_SIGNAL_GLYPHS);
  return hasPermission(where.perms, kind === 'glyph' ? PERMISSIONS.USE_EXTERNAL_GLYPHS : PERMISSIONS.USE_EXTERNAL_STICKERS);
}

export async function beaconsOf(db: any, transmitterId: string): Promise<Set<string>> {
  const rows = await db.select({ id: beaconMembers.beaconId }).from(beaconMembers).where(eq(beaconMembers.transmitterId, transmitterId));
  return new Set(rows.map((r: any) => r.id));
}

const GLYPH_TOKEN = /<a?:([A-Za-z0-9_]{1,32}):([1-9][0-9]{0,18})>/g;

/** Glyph tokens the sender may not use become plain `:name:` text, as on Discord. */
export async function stripForbiddenGlyphs(db: any, content: string, transmitterId: string, where: { beaconId?: string | null; perms: bigint | null }): Promise<string> {
  const ids = [...new Set([...content.matchAll(GLYPH_TOKEN)].map((m) => m[2]))];
  if (!ids.length) return content;
  const glyphs = await db.select({ id: beaconEmojis.id, beaconId: beaconEmojis.beaconId }).from(beaconEmojis).where(inArray(beaconEmojis.id, ids));
  const byId = new Map<string, { beaconId: string }>(glyphs.map((g: any) => [g.id, g]));
  const memberOf = await beaconsOf(db, transmitterId);
  return content.replace(GLYPH_TOKEN, (token, name, id) => {
    const g = byId.get(id);
    return g && expressionAllowed(g, where, memberOf, 'glyph') ? token : `:${name}:`;
  });
}

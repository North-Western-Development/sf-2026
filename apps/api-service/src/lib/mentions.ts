import { eq, clearances } from '@subspace/database';

export interface ParsedMentions {
  mentions: string[];
  mentionRoles: string[];
  mentionEveryone: boolean;
}

const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * Parses <@id>, <@&id>, @everyone/@here out of transmission content.
 * Unknown or invisible ids are left as plain text (not stored as mentions).
 * `@everyone`/`@here` only take effect when the author holds MENTION_EVERYONE.
 */
export async function parseMentions(
  db: any,
  content: string,
  opts: { beaconId?: string | null; validUserIds: Set<string>; authorHasMentionEveryone: boolean }
): Promise<ParsedMentions> {
  const mentions = new Set<string>();
  const mentionRoles = new Set<string>();
  let mentionEveryone = false;

  const userRe = new RegExp(`<@(${UUID_RE})>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = userRe.exec(content))) {
    if (opts.validUserIds.has(m[1])) mentions.add(m[1]);
  }

  if (opts.beaconId) {
    const roleRe = new RegExp(`<@&(${UUID_RE})>`, 'g');
    const beaconClearances = db
      ? await db.select().from(clearances).where(eq(clearances.beaconId, opts.beaconId))
      : [];
    const validRoleIds = new Set(beaconClearances.map((c: any) => c.id));
    while ((m = roleRe.exec(content))) {
      if (validRoleIds.has(m[1])) mentionRoles.add(m[1]);
    }

    if (opts.authorHasMentionEveryone && /(^|[^a-zA-Z0-9_])@(everyone|here)\b/.test(content)) {
      mentionEveryone = true;
    }
  }

  return { mentions: [...mentions], mentionRoles: [...mentionRoles], mentionEveryone };
}

import { and, eq, gte, automodRules, beaconMembers, relays, transmissions, transmitters } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { publishGatewayEvent, publishSessionRefresh } from './events.js';
import { buildMember } from './members.js';
import { formatTransmission } from './transmissions.js';
import { audit } from './audit.js';

/**
 * AutoMod (Discord's): rules a beacon sets to stop transmissions before they post.
 * Triggers: keywords (with * wildcards) and regexes, built-in word lists, mention spam, and
 * suspected spam (the same text again within a minute, or a wall of links). Actions: block it
 * (with the rule's message), post an alert to a relay, and time the author out.
 * Administrators and members who can manage the beacon are exempt, as on Discord.
 */

export const PRESET_LISTS: Record<string, string[]> = {
  profanity: ['fuck*', 'shit*', '*bitch*', 'asshole*', 'bastard*', 'dick', 'dickhead*', 'piss off', 'crap', 'bollocks', 'wanker*'],
  insults: ['idiot*', 'moron*', 'stupid', 'loser*', 'dumbass*', 'retard*', 'scum', 'trash human', 'kys', 'kill yourself'],
  sexual: ['porn*', 'nude*', 'nudes', 'hentai', 'xxx', 'onlyfans', 'nsfw pics', 'sext*', 'horny'],
};

export interface AutomodRule {
  id: string;
  name: string;
  trigger: string;
  keywords: string[];
  regexes: string[];
  allowList: string[];
  presets: string[];
  mentionLimit: number;
  blockMessage: boolean;
  customMessage: string | null;
  alertChannelId: string | null;
  timeoutSeconds: number;
  exemptClearanceIds: string[];
  exemptRelayIds: string[];
  enabled: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A keyword as Discord reads it: "cat" is the whole word, "cat*" a prefix, "*cat" a suffix,
 * "*cat*" anywhere. Returns the matched text.
 */
export function matchKeyword(content: string, keyword: string): string | null {
  const k = keyword.trim().toLowerCase();
  if (!k) return null;
  const start = k.startsWith('*');
  const end = k.endsWith('*');
  const core = escape(k.replace(/^\*|\*$/g, ''));
  if (!core) return null;
  const re = new RegExp(`${start ? '' : '(?<![\\p{L}\\p{N}])'}${start ? '[\\p{L}\\p{N}]*' : ''}${core}${end ? '[\\p{L}\\p{N}]*' : ''}${end ? '' : '(?![\\p{L}\\p{N}])'}`, 'iu');
  return re.exec(content)?.[0] ?? null;
}

/** What a rule matched in a transmission, ignoring allowed words. */
export function ruleMatch(rule: Pick<AutomodRule, 'trigger' | 'keywords' | 'regexes' | 'allowList' | 'presets' | 'mentionLimit'>, content: string, ctx: { mentionCount: number; repeats: number }): string | null {
  const allowed = (hit: string) => rule.allowList.some((a) => a.trim() && a.trim().toLowerCase() === hit.toLowerCase());
  const words = (list: string[]) => {
    for (const k of list) {
      const hit = matchKeyword(content, k);
      if (hit && !allowed(hit)) return hit;
    }
    return null;
  };
  switch (rule.trigger) {
    case 'keyword': {
      const hit = words(rule.keywords);
      if (hit) return hit;
      for (const source of rule.regexes) {
        try {
          const m = new RegExp(source, 'iu').exec(content);
          if (m && !allowed(m[0])) return m[0];
        } catch {
          /* invalid patterns are rejected on save */
        }
      }
      return null;
    }
    case 'preset':
      return words(rule.presets.flatMap((p) => PRESET_LISTS[p] ?? []));
    case 'mention_spam':
      return ctx.mentionCount > rule.mentionLimit ? `${ctx.mentionCount} mentions` : null;
    case 'spam': {
      if (ctx.repeats >= 2) return 'repeated transmission';
      const links = content.match(/https?:\/\//gi)?.length ?? 0;
      return links > 5 ? `${links} links` : null;
    }
    default:
      return null;
  }
}

export interface AutomodVerdict {
  ruleId: string;
  ruleName: string;
  matched: string;
  message: string;
}

/**
 * Runs the beacon's rules on a transmission about to be sent (or edited) in a relay. Returns the
 * rule that blocks it, after carrying out its alert and timeout; null to let it through.
 */
export async function runAutomod(
  app: any,
  db: any,
  opts: { beaconId: string; relayId: string; authorId: string; content: string; permissions: bigint; mentionCount: number }
): Promise<AutomodVerdict | null> {
  if (!db || !opts.content) return null;
  if (hasPermission(opts.permissions, PERMISSIONS.MANAGE_BEACON)) return null;
  const rules: AutomodRule[] = await db.select().from(automodRules).where(and(eq(automodRules.beaconId, opts.beaconId), eq(automodRules.enabled, true)));
  if (!rules.length) return null;

  const [member] = await db
    .select({ clearanceIds: beaconMembers.clearanceIds })
    .from(beaconMembers)
    .where(and(eq(beaconMembers.beaconId, opts.beaconId), eq(beaconMembers.transmitterId, opts.authorId)))
    .limit(1);
  const mine = new Set<string>((member?.clearanceIds as string[]) ?? []);

  let repeats = -1;
  for (const rule of rules) {
    if (rule.exemptRelayIds.includes(opts.relayId) || rule.exemptClearanceIds.some((id) => mine.has(id))) continue;
    if (rule.trigger === 'spam' && repeats < 0) {
      const since = new Date(Date.now() - 60_000);
      const recent = await db
        .select({ content: transmissions.content })
        .from(transmissions)
        .where(and(eq(transmissions.transmitterId, opts.authorId), gte(transmissions.createdAt, since)));
      repeats = recent.filter((r: any) => r.content.trim() === opts.content.trim()).length;
    }
    const matched = ruleMatch(rule, opts.content, { mentionCount: opts.mentionCount, repeats: Math.max(repeats, 0) });
    if (!matched) continue;
    await act(app, db, rule, opts, matched);
    if (!rule.blockMessage) continue;
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      matched,
      message: rule.customMessage || 'Your transmission was blocked by AutoMod in this beacon.',
    };
  }
  return null;
}

async function act(app: any, db: any, rule: AutomodRule, opts: { beaconId: string; relayId: string; authorId: string; content: string }, matched: string) {
  if (rule.timeoutSeconds > 0) {
    const until = new Date(Date.now() + rule.timeoutSeconds * 1000);
    await db.update(beaconMembers).set({ timeoutUntil: until }).where(and(eq(beaconMembers.beaconId, opts.beaconId), eq(beaconMembers.transmitterId, opts.authorId)));
    await publishGatewayEvent(app, 'MEMBER_UPDATE', { beaconId: opts.beaconId, member: await buildMember(db, app.redis, opts.beaconId, opts.authorId) }, { beaconId: opts.beaconId });
    await publishSessionRefresh(app, [opts.authorId]);
  }
  if (rule.alertChannelId) {
    const [alertRelay] = await db.select({ id: relays.id }).from(relays).where(and(eq(relays.id, rule.alertChannelId), eq(relays.beaconId, opts.beaconId))).limit(1);
    const [source] = await db.select({ name: relays.name }).from(relays).where(eq(relays.id, opts.relayId)).limit(1);
    if (alertRelay) {
      const content = JSON.stringify({ rule: rule.name, matched, relayId: opts.relayId, relayName: source?.name ?? '', content: opts.content.slice(0, 1000), blocked: rule.blockMessage, timeoutSeconds: rule.timeoutSeconds });
      const [row] = await db.insert(transmissions).values({ relayId: alertRelay.id, transmitterId: opts.authorId, content, type: 'system_automod' }).returning();
      const formatted = await formatTransmission(db, row, opts.authorId, { beaconId: opts.beaconId });
      await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: 'relay', channelId: alertRelay.id, transmission: formatted }, { relayId: alertRelay.id });
    }
  }
  const [author] = await db.select({ username: transmitters.username }).from(transmitters).where(eq(transmitters.id, opts.authorId)).limit(1);
  await audit(db, {
    beaconId: opts.beaconId,
    actorId: null,
    action: rule.blockMessage ? 'automod_block' : 'automod_flag',
    targetType: 'member',
    targetId: opts.authorId,
    targetName: author?.username ?? null,
    changes: [{ key: 'rule', new: rule.name }, { key: 'matched', new: matched }],
  });
}

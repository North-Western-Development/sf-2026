import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { commendations, transmitterCommendations, transmissions } from './schema.js';

/**
 * Commendations (badges): the catalog and the rules that award them. Shared by the API (which
 * checks when a profile is viewed) and the badge worker. Icons live in apps/web/public/badges.
 *
 * Unlockable badges come in families with levels, like Discord's: each level is its own row
 * (awarded as it is reached) and profiles show only the highest level held.
 */

export type CommendationCriteria = 'staff' | 'early_account' | 'account_age' | 'transmissions_sent' | 'voice_minutes';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface CommendationDef {
  code: string;
  name: string;
  description: string;
  criteriaType: CommendationCriteria;
  /** staff: minimum staff rank; early_account: cutoff in days since 1970; account_age: days; voice: minutes; transmissions: count. */
  threshold: number;
  family: string;
  /** 1-based level within the family. */
  tier: number;
  rarity: Rarity;
}

export interface CommendationFamily {
  family: string;
  name: string;
  /** False for badges that are granted, not earned (staff, early accounts): never listed as "available to unlock". */
  unlockable: boolean;
  criteriaType: CommendationCriteria;
  /** How to level up, shown under the ladder. */
  hint?: string;
}

/** Accounts created before 2027-01-01 are Early Transmitters. */
const EARLY_CUTOFF_DAY = Math.floor(Date.UTC(2027, 0, 1) / 86_400_000);

export const COMMENDATION_FAMILIES: CommendationFamily[] = [
  { family: 'staff', name: 'Subspace Command Staff', unlockable: false, criteriaType: 'staff' },
  { family: 'early_transmitter', name: 'Early Transmitter', unlockable: false, criteriaType: 'early_account' },
  { family: 'comm_link', name: 'Comm-Link Time', unlockable: true, criteriaType: 'voice_minutes', hint: 'Spend more time in Comm-Links and calls to level up this badge.' },
  { family: 'signal', name: 'Transmissions', unlockable: true, criteriaType: 'transmissions_sent', hint: 'Send more transmissions to level up this badge.' },
  { family: 'orbit', name: 'Orbits', unlockable: true, criteriaType: 'account_age', hint: 'Keep your account to level up this badge, one orbit a year.' },
];

const RARITY_BY_SHARE: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
/** Spreads a ladder's levels across the five rarities. */
const rarityOf = (tier: number, of: number): Rarity => RARITY_BY_SHARE[Math.min(4, Math.floor(((tier - 1) / of) * 5))];

function ladder(family: string, criteriaType: CommendationCriteria, levels: Array<[name: string, threshold: number, description: string]>): CommendationDef[] {
  return levels.map(([name, threshold, description], i) => ({
    code: `${family.toUpperCase()}_${i + 1}`,
    name,
    description,
    criteriaType,
    threshold,
    family,
    tier: i + 1,
    rarity: rarityOf(i + 1, levels.length),
  }));
}

const hours = (h: number) => h * 60;

export const COMMENDATION_CATALOG: CommendationDef[] = [
  { code: 'STAFF', name: 'Subspace Command Staff', description: 'Part of the team that runs Subspace Frequency.', criteriaType: 'staff', threshold: 1, family: 'staff', tier: 1, rarity: 'legendary' },
  { code: 'EARLY_TRANSMITTER', name: 'Early Transmitter', description: 'Tuned in before Subspace Frequency launched.', criteriaType: 'early_account', threshold: EARLY_CUTOFF_DAY, family: 'early_transmitter', tier: 1, rarity: 'epic' },
  ...ladder('comm_link', 'voice_minutes', [
    ['Static', hours(1), '1 hour in Comm-Links and calls'],
    ['Carrier', hours(5), '5 hours in Comm-Links and calls'],
    ['Relay', hours(20), '20 hours in Comm-Links and calls'],
    ['Booster', hours(75), '75 hours in Comm-Links and calls'],
    ['Beacon', hours(150), '150 hours in Comm-Links and calls'],
    ['Pulsar', hours(300), '300 hours in Comm-Links and calls'],
    ['Quasar', hours(500), '500 hours in Comm-Links and calls'],
    ['Supernova', hours(1000), '1,000 hours in Comm-Links and calls'],
  ]),
  ...ladder('signal', 'transmissions_sent', [
    ['Ping', 10, '10 transmissions sent'],
    ['Chatter', 100, '100 transmissions sent'],
    ['Signal Booster', 500, '500 transmissions sent'],
    ['Broadcaster', 1000, '1,000 transmissions sent'],
    ['Amplifier', 5000, '5,000 transmissions sent'],
    ['Megaphone', 10000, '10,000 transmissions sent'],
  ]),
  ...ladder('orbit', 'account_age', [
    ['One Orbit', 365, 'A year on Subspace'],
    ['Two Orbits', 730, 'Two years on Subspace'],
    ['Three Orbits', 1095, 'Three years on Subspace'],
    ['Five Orbits', 1825, 'Five years on Subspace'],
  ]),
];

const BY_CODE = new Map(COMMENDATION_CATALOG.map((c) => [c.code, c]));
export const commendationDef = (code: string) => BY_CODE.get(code);

/** Display order follows the catalog: staff first, then the granted badges, then the ladders. */
export const commendationOrder = (code: string) => {
  const i = COMMENDATION_CATALOG.findIndex((c) => c.code === code);
  return i === -1 ? COMMENDATION_CATALOG.length : i;
};

export const badgeIconUrl = (code: string) => `/badges/${code.toLowerCase()}.svg`;

/** Badges staff make in the Command Console: code custom_<id>, outside the catalog. */
export const isCustomBadgeCode = (code: string) => code.startsWith('custom_');

/**
 * Profiles show one badge per family: the highest level held. Custom badges are each their own
 * family, a staff rank's badge first of all. Rows not in the catalog (retired badges) are dropped.
 */
export function highestPerFamily<T extends { code: string; criteriaType?: string }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  const custom: T[] = [];
  for (const r of rows) {
    if (isCustomBadgeCode(r.code)) {
      custom.push(r);
      continue;
    }
    const def = BY_CODE.get(r.code);
    if (!def) continue;
    const current = best.get(def.family);
    if (!current || BY_CODE.get(current.code)!.tier < def.tier) best.set(def.family, r);
  }
  const rank = (r: T) => (r.criteriaType === 'staff_role' ? -1 : isCustomBadgeCode(r.code) ? COMMENDATION_CATALOG.length : commendationOrder(r.code));
  return [...best.values(), ...custom].sort((a, b) => rank(a) - rank(b));
}

/** Inserts or refreshes the catalog rows (run at API startup). */
export async function syncCommendationCatalog(db: any) {
  for (const c of COMMENDATION_CATALOG) {
    const row = { code: c.code, name: c.name, description: c.description, criteriaType: c.criteriaType, threshold: c.threshold, iconUrl: badgeIconUrl(c.code) };
    await db
      .insert(commendations)
      .values(row)
      .onConflictDoUpdate({ target: commendations.code, set: { name: row.name, description: row.description, iconUrl: row.iconUrl, criteriaType: row.criteriaType, threshold: row.threshold } });
  }
}

export interface CommendationStats {
  staffRank: number;
  /** Their staff rank's own badge, which replaces the generic Staff badge. */
  staffBadgeId?: string | null;
  createdAt: Date;
  /** Read lazily: only counted when a transmission badge is still unearned. */
  transmissionsSent?: () => Promise<number>;
  voiceMinutes?: number;
}

export function qualifies(def: Pick<CommendationDef, 'criteriaType' | 'threshold'>, s: { staffRank: number; createdAt: Date; transmissionsSent?: number; voiceMinutes?: number }, now = Date.now()) {
  switch (def.criteriaType) {
    case 'staff':
      return s.staffRank >= def.threshold;
    case 'early_account':
      return s.createdAt.getTime() < def.threshold * 86_400_000;
    case 'account_age':
      return now - s.createdAt.getTime() >= def.threshold * 86_400_000;
    case 'transmissions_sent':
      return (s.transmissionsSent ?? 0) >= def.threshold;
    case 'voice_minutes':
      return (s.voiceMinutes ?? 0) >= def.threshold;
  }
}

const RULE_CRITERIA = ['account_age', 'transmissions_sent', 'voice_minutes'];

/**
 * Brings someone's badges up to date: awards every catalog badge and custom rule badge they now
 * qualify for, and their staff rank's badge; takes away staff badges they no longer hold (a
 * demotion, a changed rank). Returns the newly awarded codes.
 */
export async function awardEligibleCommendations(db: any, transmitterId: string, stats: CommendationStats): Promise<string[]> {
  const ownedRows: Array<{ id: string; code: string; criteriaType: string }> = await db
    .select({ id: commendations.id, code: commendations.code, criteriaType: commendations.criteriaType })
    .from(transmitterCommendations)
    .innerJoin(commendations, eq(transmitterCommendations.commendationId, commendations.id))
    .where(eq(transmitterCommendations.transmitterId, transmitterId));
  const owned = new Set(ownedRows.map((r) => r.code));
  const staffBadgeId = stats.staffRank > 0 ? stats.staffBadgeId ?? null : null;
  // The generic Staff badge only for staff whose rank has no badge of its own.
  const effective = { ...stats, staffRank: staffBadgeId ? 0 : stats.staffRank };

  const stale = ownedRows.filter((r) => (r.criteriaType === 'staff' && effective.staffRank < 1) || (r.criteriaType === 'staff_role' && r.id !== staffBadgeId));
  if (stale.length) {
    await db.delete(transmitterCommendations).where(
      and(
        eq(transmitterCommendations.transmitterId, transmitterId),
        inArray(
          transmitterCommendations.commendationId,
          stale.map((r) => r.id)
        )
      )
    );
  }

  const customRules: Array<{ id: string; code: string; criteriaType: CommendationCriteria; threshold: number }> = await db
    .select({ id: commendations.id, code: commendations.code, criteriaType: commendations.criteriaType, threshold: commendations.threshold })
    .from(commendations)
    .where(and(eq(commendations.isCustom, true), inArray(commendations.criteriaType, RULE_CRITERIA)));
  const pending = COMMENDATION_CATALOG.filter((c) => !owned.has(c.code));
  const pendingCustom = customRules.filter((c) => !owned.has(c.code));
  const roleBadge = staffBadgeId && !ownedRows.some((r) => r.id === staffBadgeId) ? staffBadgeId : null;
  if (!pending.length && !pendingCustom.length && !roleBadge) return [];

  const needsCount = [...pending, ...pendingCustom].some((c) => c.criteriaType === 'transmissions_sent');
  const sent = needsCount && stats.transmissionsSent ? await stats.transmissionsSent() : 0;
  const measured = { ...effective, transmissionsSent: sent };
  const earnedCustom = pendingCustom.filter((c) => qualifies(c, measured));
  const extra = [...earnedCustom.map((c) => c.id), ...(roleBadge ? [roleBadge] : [])];
  if (extra.length) {
    await db
      .insert(transmitterCommendations)
      .values(extra.map((commendationId) => ({ transmitterId, commendationId, displayOrder: commendationId === roleBadge ? -1 : COMMENDATION_CATALOG.length })))
      .onConflictDoNothing();
  }
  const extraCodes = [...earnedCustom.map((c) => c.code), ...(roleBadge ? [`role:${roleBadge}`] : [])];

  const earned = pending.filter((c) => qualifies(c, measured));
  if (!earned.length) return extraCodes;

  const codes = earned.map((c) => c.code);
  const lookup = () => db.select({ id: commendations.id, code: commendations.code }).from(commendations).where(inArray(commendations.code, codes));
  let rows = await lookup();
  if (rows.length < codes.length) {
    await syncCommendationCatalog(db);
    rows = await lookup();
  }
  if (!rows.length) return extraCodes;
  await db
    .insert(transmitterCommendations)
    .values(rows.map((r: { id: string; code: string }) => ({ transmitterId, commendationId: r.id, displayOrder: commendationOrder(r.code) })))
    .onConflictDoNothing();
  return [...rows.map((r: { code: string }) => r.code), ...extraCodes];
}

/** Transmissions a transmitter has sent (system messages excluded). */
export async function countTransmissionsSent(db: any, transmitterId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transmissions)
    .where(and(eq(transmissions.transmitterId, transmitterId), sql`${transmissions.type} not like 'system%'`));
  return Number(row?.n ?? 0);
}

/** Redis hash holding activity totals the gateway records (voice minutes). */
export const statsKey = (transmitterId: string) => `stats:${transmitterId}`;

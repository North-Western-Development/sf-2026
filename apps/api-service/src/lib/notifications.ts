import { eq, and, inArray, or, notificationSettings, beaconMembers, beacons } from '@subspace/database';

export interface ScopeRef {
  scopeType: 'relay' | 'category' | 'beacon' | 'link' | 'mesh' | 'global';
  scopeId: string;
}

export interface EffectiveNotification {
  level: 'all' | 'mentions' | 'nothing';
  muted: boolean;
  suppressEveryone: boolean;
  suppressRoles: boolean;
  suppressHighlights: boolean;
  mobilePush: boolean;
}

/** Far-future sentinel used to represent an indefinite ("infinity") mute. */
export const INFINITE_MUTE = new Date('9999-12-31T00:00:00.000Z');

export async function defaultLevelForRelay(db: any, beaconId: string): Promise<'all' | 'mentions'> {
  // The beacon's Default Notification Settings (Engagement), else all under 100 members.
  const [beacon] = await db.select({ level: beacons.defaultNotifications }).from(beacons).where(eq(beacons.id, beaconId)).limit(1);
  if (beacon?.level === 'all' || beacon?.level === 'mentions') return beacon.level;
  const members = await db.select().from(beaconMembers).where(eq(beaconMembers.beaconId, beaconId));
  return members.length > 100 ? 'mentions' : 'all';
}

/**
 * Resolves effective notification settings for a transmitter across a scope chain
 * ordered narrow -> broad (e.g. relay -> category -> beacon -> global).
 * `level` inherits up the chain (first non-'inherit' row wins, plus its sibling fields).
 * `mutedUntil` is independent: the first scope with a mute set wins, regardless of level.
 */
export async function resolveEffectiveNotification(
  db: any,
  transmitterId: string,
  scopeChain: ScopeRef[],
  defaultLevel: 'all' | 'mentions'
): Promise<EffectiveNotification> {
  if (!db || scopeChain.length === 0) {
    return { level: defaultLevel, muted: false, suppressEveryone: false, suppressRoles: false, suppressHighlights: false, mobilePush: true };
  }

  const conditions = scopeChain.map((s) => and(eq(notificationSettings.scopeType, s.scopeType), eq(notificationSettings.scopeId, s.scopeId)));
  const rows = await db
    .select()
    .from(notificationSettings)
    .where(and(eq(notificationSettings.transmitterId, transmitterId), or(...conditions)));

  const map = new Map(rows.map((r: any) => [`${r.scopeType}:${r.scopeId}`, r]));

  let level: 'all' | 'mentions' | 'nothing' = defaultLevel;
  let suppressEveryone = false;
  let suppressRoles = false;
  let suppressHighlights = false;
  let mobilePush = true;

  for (const scope of scopeChain) {
    const row: any = map.get(`${scope.scopeType}:${scope.scopeId}`);
    if (row && row.level && row.level !== 'inherit') {
      level = row.level;
      suppressEveryone = row.suppressEveryone;
      suppressRoles = row.suppressRoles;
      suppressHighlights = row.suppressHighlights;
      mobilePush = row.mobilePush;
      break;
    }
  }

  let muted = false;
  const now = new Date();
  for (const scope of scopeChain) {
    const row: any = map.get(`${scope.scopeType}:${scope.scopeId}`);
    if (row?.mutedUntil && new Date(row.mutedUntil) > now) {
      muted = true;
      break;
    }
  }

  return { level, muted, suppressEveryone, suppressRoles, suppressHighlights, mobilePush };
}

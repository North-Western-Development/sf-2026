import { and, eq, asc, beacons, clearances, relays, type TemplateSnapshot } from '@subspace/database';
import { DEFAULT_EVERYONE_PERMISSIONS } from '@subspace/constants';

/**
 * Beacon templates (Discord's server templates): a snapshot of relays, bands, clearances and a
 * few settings, never members or messages. The built-in ones are the starters Create a Beacon
 * offers; members' own are saved from a beacon's settings and shared by code.
 */

type Band = { name: string; text?: string[]; voice?: string[] };
const starter = (bands: Band[]): TemplateSnapshot => {
  const out: TemplateSnapshot['relays'] = [];
  bands.forEach((b, i) => {
    const key = `band${i}`;
    out.push({ key, name: b.name, type: 'category', topic: null, parentKey: null, position: i });
    (b.text ?? []).forEach((name, j) => out.push({ key: `${key}t${j}`, name, type: 'text', topic: null, parentKey: key, position: j }));
    (b.voice ?? []).forEach((name, j) => out.push({ key: `${key}v${j}`, name, type: 'comm_link', topic: null, parentKey: key, position: (b.text?.length ?? 0) + j }));
  });
  const firstText = out.find((r) => r.type === 'text')?.key ?? null;
  return {
    relays: out,
    clearances: [{ name: '@everyone', color: '#99AAB5', position: 0, permissions: DEFAULT_EVERYONE_PERMISSIONS.toString(), hoist: false }],
    settings: { defaultNotifications: null, verificationLevel: 'none', systemChannelKey: firstText, afkChannelKey: null, afkTimeout: 300 },
  };
};

export const BUILTIN_TEMPLATES: Record<string, TemplateSnapshot> = {
  gaming: starter([
    { name: 'Information', text: ['welcome-and-rules', 'announcements'] },
    { name: 'Text Relays', text: ['general', 'clips-and-highlights'] },
    { name: 'Comm-Links', voice: ['Lobby', 'Gaming'] },
  ]),
  'school-club': starter([
    { name: 'Information', text: ['welcome-and-rules', 'announcements', 'resources'] },
    { name: 'Text Relays', text: ['general', 'meeting-plans', 'off-topic'] },
    { name: 'Comm-Links', voice: ['Lounge', 'Meeting Room'] },
  ]),
  'study-group': starter([
    { name: 'Welcome', text: ['welcome-and-rules', 'notes-resources'] },
    { name: 'Text Relays', text: ['general', 'homework-help', 'session-planning', 'off-topic'] },
    { name: 'Comm-Links', voice: ['Lounge', 'Study Room 1', 'Study Room 2'] },
  ]),
  friends: starter([
    { name: 'Text Relays', text: ['general', 'games', 'music'] },
    { name: 'Comm-Links', voice: ['Lounge', 'Stream Room'] },
  ]),
  'artists-creators': starter([
    { name: 'Information', text: ['welcome-and-rules', 'announcements'] },
    { name: 'Text Relays', text: ['general', 'events', 'ideas-and-feedback'] },
    { name: 'Comm-Links', voice: ['Lounge', 'Community Hangout', 'Stream Room'] },
  ]),
  'local-community': starter([
    { name: 'Information', text: ['welcome-and-rules', 'announcements', 'resources'] },
    { name: 'Text Relays', text: ['general', 'meeting-plans', 'off-topic'] },
    { name: 'Comm-Links', voice: ['Lounge', 'Meeting Room'] },
  ]),
};

/** A beacon's layout as a template snapshot. */
export async function snapshotOf(db: any, beaconId: string): Promise<TemplateSnapshot> {
  const [beacon] = await db.select().from(beacons).where(eq(beacons.id, beaconId)).limit(1);
  const rows = await db.select().from(relays).where(eq(relays.beaconId, beaconId)).orderBy(asc(relays.position));
  const keyOf = new Map<string, string>(rows.map((r: any, i: number) => [r.id, `r${i}`]));
  const roles = await db.select().from(clearances).where(eq(clearances.beaconId, beaconId)).orderBy(asc(clearances.position));
  return {
    relays: rows.map((r: any) => ({
      key: keyOf.get(r.id)!,
      name: r.name,
      type: r.type,
      topic: r.topic ?? null,
      parentKey: r.parentId ? keyOf.get(r.parentId) ?? null : null,
      position: r.position,
    })),
    clearances: roles.map((c: any) => ({ name: c.name, color: c.color, position: c.position, permissions: c.permissions.toString(), hoist: c.hoist, mentionable: c.mentionable })),
    settings: {
      defaultNotifications: beacon?.defaultNotifications ?? null,
      verificationLevel: beacon?.verificationLevel ?? 'none',
      systemChannelKey: beacon?.systemChannelId ? keyOf.get(beacon.systemChannelId) ?? null : null,
      afkChannelKey: beacon?.afkChannelId ? keyOf.get(beacon.afkChannelId) ?? null : null,
      afkTimeout: beacon?.afkTimeout ?? 300,
    },
  };
}

/** Builds a new beacon's relays, clearances and settings from a snapshot. */
export async function applyTemplate(db: any, beaconId: string, snap: TemplateSnapshot) {
  const ids = new Map<string, string>();
  // Bands first, so relays can name their parent.
  for (const r of [...snap.relays].sort((a, b) => Number(!!a.parentKey) - Number(!!b.parentKey))) {
    const [row] = await db
      .insert(relays)
      .values({ beaconId, name: r.name, type: r.type, topic: r.topic, position: r.position, parentId: r.parentKey ? ids.get(r.parentKey) ?? null : null })
      .returning({ id: relays.id });
    ids.set(r.key, row.id);
  }
  for (const c of snap.clearances) {
    if (c.position === 0) {
      await db.update(clearances).set({ permissions: BigInt(c.permissions) }).where(and(eq(clearances.beaconId, beaconId), eq(clearances.position, 0)));
    } else {
      await db.insert(clearances).values({ beaconId, name: c.name, color: c.color, position: c.position, permissions: BigInt(c.permissions), hoist: c.hoist, mentionable: !!c.mentionable });
    }
  }
  const s = snap.settings;
  await db
    .update(beacons)
    .set({
      defaultNotifications: s.defaultNotifications,
      verificationLevel: s.verificationLevel,
      systemChannelId: s.systemChannelKey ? ids.get(s.systemChannelKey) ?? null : null,
      afkChannelId: s.afkChannelKey ? ids.get(s.afkChannelKey) ?? null : null,
      afkTimeout: s.afkTimeout,
    })
    .where(eq(beacons.id, beaconId));
}

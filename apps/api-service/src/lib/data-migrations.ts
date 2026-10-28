import { sql } from 'drizzle-orm';
import { eq, clearances, transmitters, beaconClusters, dataMigrations, relayOverwrites } from '@subspace/database';
import { DEFAULT_EVERYONE_PERMISSIONS, withSplits } from '@subspace/constants';

interface DataMigration {
  id: string;
  run: (db: any) => Promise<void>;
}

/**
 * Data migrations run exactly once per database (recorded in data_migrations), so later
 * administrator choices are never overwritten on restart.
 */
const MIGRATIONS: DataMigration[] = [
  {
    // Discord-parity permission bits for beacons created before they existed.
    id: '2026-09-27-everyone-parity-bits',
    run: (db) =>
      db
        .update(clearances)
        .set({ permissions: sql`${clearances.permissions} | ${DEFAULT_EVERYONE_PERMISSIONS.toString()}::bigint` })
        .where(eq(clearances.position, 0)),
  },
  {
    // Old cyan defaults predate the NWD palette; untouched values become the new defaults.
    id: '2026-09-28-nwd-palette-defaults',
    run: async (db) => {
      await db.update(transmitters).set({ displayColor: '#EEF1FA' }).where(eq(transmitters.displayColor, '#00F0FF'));
      await db.update(transmitters).set({ bannerColor: '#3353D6' }).where(eq(transmitters.bannerColor, '#0B0E14'));
      await db.update(beaconClusters).set({ color: '#3B8EF2' }).where(eq(beaconClusters.color, '#00F0FF'));
    },
  },
  {
    // Use Soundboard and Create Threads came later; @everyone has them by default, as on Discord.
    id: '2026-10-25-soundboard-threads-bits',
    run: (db) =>
      db
        .update(clearances)
        .set({ permissions: sql`${clearances.permissions} | ${((1n << 28n) | (1n << 30n)).toString()}::bigint` })
        .where(eq(clearances.position, 0)),
  },
  {
    // Use Activities came with activities in comm-links; @everyone has it by default.
    id: '2026-10-25-activities-bit',
    run: (db) =>
      db
        .update(clearances)
        .set({ permissions: sql`${clearances.permissions} | ${(1n << 31n).toString()}::bigint` })
        .where(eq(clearances.position, 0)),
  },
  {
    // Finer permissions split off broader ones: whoever held (or was denied) the old one gets the
    // new one too, so existing beacons behave as before. @everyone also gets the new defaults
    // that did not exist before (polls, voice messages, external glyphs, voice activity...).
    id: '2026-10-27-permission-splits',
    run: async (db) => {
      for (const c of await db.select({ id: clearances.id, permissions: clearances.permissions, position: clearances.position }).from(clearances)) {
        const before = BigInt(c.permissions);
        const after = withSplits(before) | (c.position === 0 ? DEFAULT_EVERYONE_PERMISSIONS & ~before & NEW_DEFAULTS : 0n);
        if (after !== before) await db.update(clearances).set({ permissions: after }).where(eq(clearances.id, c.id));
      }
      for (const o of await db.select().from(relayOverwrites)) {
        const allow = withSplits(BigInt(o.allowBits));
        const deny = withSplits(BigInt(o.denyBits));
        if (allow !== BigInt(o.allowBits) || deny !== BigInt(o.denyBits)) await db.update(relayOverwrites).set({ allowBits: allow, denyBits: deny }).where(eq(relayOverwrites.id, o.id));
      }
      // Anyone could mention any clearance before the setting existed; keep it that way for them.
      await db.update(clearances).set({ mentionable: true });
    },
  },
  {
    // Webhooks and bots came later: Manage Beacon holders get Manage Webhooks, and whoever can
    // send transmissions can use slash commands, as on Discord.
    id: '2026-10-27-webhooks-commands',
    run: async (db) => {
      const pairs: Array<[bigint, bigint]> = [
        [1n << 16n, 1n << 50n],
        [1n << 1n, 1n << 51n],
      ];
      const add = (bits: bigint) => pairs.reduce((out, [from, to]) => ((bits & from) === from ? out | to : out), bits);
      for (const c of await db.select({ id: clearances.id, permissions: clearances.permissions }).from(clearances)) {
        const after = add(BigInt(c.permissions));
        if (after !== BigInt(c.permissions)) await db.update(clearances).set({ permissions: after }).where(eq(clearances.id, c.id));
      }
      for (const o of await db.select().from(relayOverwrites)) {
        const allow = add(BigInt(o.allowBits));
        const deny = add(BigInt(o.denyBits));
        if (allow !== BigInt(o.allowBits) || deny !== BigInt(o.denyBits)) await db.update(relayOverwrites).set({ allowBits: allow, denyBits: deny }).where(eq(relayOverwrites.id, o.id));
      }
    },
  },
];

/** Defaults with no older permission to inherit from: @everyone simply gets them. */
const NEW_DEFAULTS = (1n << 42n) | (1n << 43n) | (1n << 44n) | (1n << 45n) | (1n << 46n) | (1n << 48n) | (1n << 37n) | (1n << 38n);

export async function runDataMigrations(db: any, log: { info: (...a: any[]) => void; warn: (...a: any[]) => void }) {
  const applied = new Set((await db.select().from(dataMigrations)).map((r: any) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    try {
      await db.transaction(async (tx: any) => {
        await m.run(tx);
        await tx.insert(dataMigrations).values({ id: m.id });
      });
      log.info({ migration: m.id }, 'Applied data migration');
    } catch (err) {
      log.warn({ err, migration: m.id }, 'Data migration failed; will retry on next boot');
    }
  }
}

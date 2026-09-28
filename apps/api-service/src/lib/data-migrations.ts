import { sql } from 'drizzle-orm';
import { eq, clearances, transmitters, beaconClusters, dataMigrations } from '@subspace/database';
import { DEFAULT_EVERYONE_PERMISSIONS } from '@subspace/constants';

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
];

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

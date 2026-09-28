import { describe, it, expect } from 'vitest';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, dataMigrations, eq } from '@subspace/database';

describe('One-time data migrations', () => {
  const owner = { id: 'd1000000-0000-4000-8000-000000000001', username: 'migration_owner' };
  const token = () => signAccessToken({ transmitterId: owner.id, username: owner.username, staffRank: 0 }, getJwtSecret());

  it('records migrations and never re-applies them on restart', async () => {
    let app = await buildApp();
    await app.ready();
    const db = (app as any).db;
    const existing = await db.select().from(transmitters).where(eq(transmitters.id, owner.id)).limit(1);
    if (!existing.length) await db.insert(transmitters).values({ id: owner.id, username: owner.username, email: `${owner.username}@subspace.test`, passwordHash: 'x', displayName: 'Owner' });

    const applied = (await db.select().from(dataMigrations)).map((r: any) => r.id);
    expect(applied).toContain('2026-09-27-everyone-parity-bits');

    // Admin removes ADD_REACTIONS from @everyone.
    const beacon = (await app.inject({ method: 'POST', url: '/api/v1/beacons', headers: { authorization: `Bearer ${token()}` }, payload: { name: 'Migration Check' } })).json().beacon;
    const everyone = (await app.inject({ method: 'GET', url: `/api/v1/beacons/${beacon.id}/clearances`, headers: { authorization: `Bearer ${token()}` } }))
      .json()
      .clearances.find((c: any) => c.position === 0);
    const reduced = BigInt(everyone.permissions) & ~PERMISSIONS.ADD_REACTIONS;
    await app.inject({ method: 'PATCH', url: `/api/v1/beacons/${beacon.id}/clearances/${everyone.id}`, headers: { authorization: `Bearer ${token()}` }, payload: { permissions: reduced.toString() } });
    await app.close();

    // Restart: the choice must survive.
    app = await buildApp();
    await app.ready();
    const after = (await app.inject({ method: 'GET', url: `/api/v1/beacons/${beacon.id}/clearances`, headers: { authorization: `Bearer ${token()}` } }))
      .json()
      .clearances.find((c: any) => c.position === 0);
    expect(BigInt(after.permissions) & PERMISSIONS.ADD_REACTIONS).toBe(0n);
    await app.close();
  });
});

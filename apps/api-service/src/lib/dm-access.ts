import { and, eq, or, affiliations, transmissionRequests, beaconMembers } from '@subspace/database';

export type DmAccess =
  | { ok: true; via: 'affiliation' | 'request' | 'beacon'; beaconId?: string }
  | { ok: false; code: 'NO_SHARED_BEACON' | 'DMS_DISABLED'; error: string };

export async function areAffiliated(db: any, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ id: affiliations.transmitterId })
    .from(affiliations)
    .where(
      and(
        eq(affiliations.status, 'accepted'),
        or(and(eq(affiliations.transmitterId, a), eq(affiliations.targetId, b)), and(eq(affiliations.transmitterId, b), eq(affiliations.targetId, a)))
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Whether `senderId` may DM `targetId`, as Discord decides it: affiliates always can (and so can
 * two people whose transmission request was accepted); anyone else needs a shared beacon where the
 * target allows DMs from members (that beacon's Privacy Settings).
 */
export async function dmAccess(db: any, senderId: string, targetId: string): Promise<DmAccess> {
  if (await areAffiliated(db, senderId, targetId)) return { ok: true, via: 'affiliation' };
  const [accepted] = await db
    .select({ id: transmissionRequests.id })
    .from(transmissionRequests)
    .where(
      and(
        eq(transmissionRequests.status, 'accepted'),
        or(
          and(eq(transmissionRequests.senderId, senderId), eq(transmissionRequests.recipientId, targetId)),
          and(eq(transmissionRequests.senderId, targetId), eq(transmissionRequests.recipientId, senderId))
        )
      )
    )
    .limit(1);
  if (accepted) return { ok: true, via: 'request' };

  const mine = await db.select({ beaconId: beaconMembers.beaconId }).from(beaconMembers).where(eq(beaconMembers.transmitterId, senderId));
  const theirs = await db
    .select({ beaconId: beaconMembers.beaconId, allowDms: beaconMembers.allowDms })
    .from(beaconMembers)
    .where(eq(beaconMembers.transmitterId, targetId));
  const mineSet = new Set(mine.map((m: any) => m.beaconId));
  const shared = theirs.filter((t: any) => mineSet.has(t.beaconId));
  const open = shared.find((t: any) => t.allowDms);
  if (open) return { ok: true, via: 'beacon', beaconId: open.beaconId };
  if (shared.length) return { ok: false, code: 'DMS_DISABLED', error: 'This transmitter is not accepting direct links from members of your shared beacons' };
  return { ok: false, code: 'NO_SHARED_BEACON', error: 'Cannot initiate transmission link without sharing a mutual Beacon' };
}

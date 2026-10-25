import { and, eq, or, affiliations, transmissionRequests, beaconMembers, beacons, transmitters } from '@subspace/database';

/** A beacon's Privacy Settings start from the member's default (Data & Privacy). */
export async function defaultAllowDms(db: any, transmitterId: string): Promise<boolean> {
  const [row] = await db.select({ v: transmitters.defaultAllowDms }).from(transmitters).where(eq(transmitters.id, transmitterId)).limit(1);
  return row?.v ?? true;
}

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
    .select({ beaconId: beaconMembers.beaconId, allowDms: beaconMembers.allowDms, dmsPausedUntil: beacons.dmsPausedUntil })
    .from(beaconMembers)
    .innerJoin(beacons, eq(beacons.id, beaconMembers.beaconId))
    .where(eq(beaconMembers.transmitterId, targetId));
  const mineSet = new Set(mine.map((m: any) => m.beaconId));
  const shared = theirs.filter((t: any) => mineSet.has(t.beaconId));
  // A beacon whose admins paused DMs (Security Actions) does not count until the pause ends.
  const open = shared.find((t: any) => t.allowDms && !(t.dmsPausedUntil && new Date(t.dmsPausedUntil) > new Date()));
  if (open) return { ok: true, via: 'beacon', beaconId: open.beaconId };
  if (shared.length) return { ok: false, code: 'DMS_DISABLED', error: 'This transmitter is not accepting direct links from members of your shared beacons' };
  return { ok: false, code: 'NO_SHARED_BEACON', error: 'Cannot initiate transmission link without sharing a mutual Beacon' };
}

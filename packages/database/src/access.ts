import { eq, and, or, inArray } from 'drizzle-orm';
import { PERMISSIONS, computeMemberPermissions, hasPermission } from '@subspace/constants';
import {
  beacons,
  beaconMembers,
  clearances,
  relays,
  subspaceMeshMembers,
  affiliations,
  pointToPointLinks,
} from './schema.js';

/**
 * Shared audience resolution used by api-service (when publishing gateway events)
 * and gateway-service (when deciding which sessions may observe presence / voice).
 * Every function fails closed: unknown ids resolve to an empty audience.
 */

type Db = any;

/** Transmitter ids that may VIEW the given relay (owner + members holding VIEW_RELAY). */
export async function resolveRelayAudience(db: Db, relayId: string): Promise<string[]> {
  const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
  if (!relay) return [];
  return resolveBeaconAudience(db, relay.beaconId, PERMISSIONS.VIEW_RELAY);
}

/**
 * Transmitter ids belonging to a beacon, optionally filtered by a permission bit.
 * The owner is always included.
 */
export async function resolveBeaconAudience(
  db: Db,
  beaconId: string,
  requiredPermission?: bigint
): Promise<string[]> {
  const [beacon] = await db.select().from(beacons).where(eq(beacons.id, beaconId)).limit(1);
  if (!beacon) return [];

  const members: Array<typeof beaconMembers.$inferSelect> = await db
    .select()
    .from(beaconMembers)
    .where(eq(beaconMembers.beaconId, beaconId));

  const audience = new Set<string>([beacon.ownerId]);

  if (requiredPermission === undefined) {
    for (const m of members) audience.add(m.transmitterId);
    return [...audience];
  }

  const beaconClearances: Array<typeof clearances.$inferSelect> = await db
    .select()
    .from(clearances)
    .where(eq(clearances.beaconId, beaconId));

  for (const m of members) {
    const assigned = new Set(m.clearanceIds || []);
    const active = beaconClearances.filter((c) => c.position === 0 || assigned.has(c.id));
    const perms = computeMemberPermissions(active, m.transmitterId === beacon.ownerId);
    if (hasPermission(perms, requiredPermission)) audience.add(m.transmitterId);
  }
  return [...audience];
}

/** Transmitter ids participating in a mesh (group link). */
export async function resolveMeshAudience(db: Db, meshId: string): Promise<string[]> {
  const rows: Array<{ transmitterId: string }> = await db
    .select({ transmitterId: subspaceMeshMembers.transmitterId })
    .from(subspaceMeshMembers)
    .where(eq(subspaceMeshMembers.meshId, meshId));
  return rows.map((r) => r.transmitterId);
}

/** Beacon ids a transmitter owns or belongs to. */
export async function resolveTransmitterBeaconIds(db: Db, transmitterId: string): Promise<string[]> {
  const memberRows: Array<{ beaconId: string }> = await db
    .select({ beaconId: beaconMembers.beaconId })
    .from(beaconMembers)
    .where(eq(beaconMembers.transmitterId, transmitterId));
  const ownedRows: Array<{ id: string }> = await db
    .select({ id: beacons.id })
    .from(beacons)
    .where(eq(beacons.ownerId, transmitterId));
  return [...new Set([...memberRows.map((r) => r.beaconId), ...ownedRows.map((r) => r.id)])];
}

/**
 * Every transmitter who has a legitimate reason to observe this transmitter's presence:
 * beacon co-members, accepted affiliations, mesh co-members, and point-to-point link partners.
 */
export async function resolvePresencePeers(db: Db, transmitterId: string): Promise<string[]> {
  const peers = new Set<string>();

  const beaconIds = await resolveTransmitterBeaconIds(db, transmitterId);
  if (beaconIds.length > 0) {
    const coMembers: Array<{ transmitterId: string }> = await db
      .select({ transmitterId: beaconMembers.transmitterId })
      .from(beaconMembers)
      .where(inArray(beaconMembers.beaconId, beaconIds));
    coMembers.forEach((r) => peers.add(r.transmitterId));
    const owners: Array<{ ownerId: string }> = await db
      .select({ ownerId: beacons.ownerId })
      .from(beacons)
      .where(inArray(beacons.id, beaconIds));
    owners.forEach((r) => peers.add(r.ownerId));
  }

  const affRows: Array<{ transmitterId: string; targetId: string }> = await db
    .select({ transmitterId: affiliations.transmitterId, targetId: affiliations.targetId })
    .from(affiliations)
    .where(
      and(
        eq(affiliations.status, 'accepted'),
        or(eq(affiliations.transmitterId, transmitterId), eq(affiliations.targetId, transmitterId))
      )
    );
  affRows.forEach((r) => {
    peers.add(r.transmitterId);
    peers.add(r.targetId);
  });

  const myMeshes: Array<{ meshId: string }> = await db
    .select({ meshId: subspaceMeshMembers.meshId })
    .from(subspaceMeshMembers)
    .where(eq(subspaceMeshMembers.transmitterId, transmitterId));
  if (myMeshes.length > 0) {
    const meshPeers: Array<{ transmitterId: string }> = await db
      .select({ transmitterId: subspaceMeshMembers.transmitterId })
      .from(subspaceMeshMembers)
      .where(inArray(subspaceMeshMembers.meshId, myMeshes.map((m) => m.meshId)));
    meshPeers.forEach((r) => peers.add(r.transmitterId));
  }

  const links: Array<{ a: string; b: string }> = await db
    .select({ a: pointToPointLinks.transmitter1Id, b: pointToPointLinks.transmitter2Id })
    .from(pointToPointLinks)
    .where(
      or(
        eq(pointToPointLinks.transmitter1Id, transmitterId),
        eq(pointToPointLinks.transmitter2Id, transmitterId)
      )
    );
  links.forEach((r) => {
    peers.add(r.a);
    peers.add(r.b);
  });

  peers.delete(transmitterId);
  return [...peers];
}

/** Returns the relay's beacon id when the transmitter may CONNECT_AUDIO to it, otherwise null. */
export async function authorizeVoiceRelay(
  db: Db,
  transmitterId: string,
  relayId: string
): Promise<string | null> {
  const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
  if (!relay || relay.type !== 'comm_link') return null;
  const audience = await resolveBeaconAudience(db, relay.beaconId, PERMISSIONS.CONNECT_AUDIO);
  return audience.includes(transmitterId) ? relay.beaconId : null;
}

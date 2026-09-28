import { eq, and, or, inArray } from 'drizzle-orm';
import { PERMISSIONS, computeMemberPermissions, hasPermission } from '@subspace/constants';
import {
  beacons,
  beaconMembers,
  clearances,
  relays,
  relayOverwrites,
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

/**
 * Discord-parity effective-permission algorithm for a member in a specific relay:
 * 1. Owner or ADMINISTRATOR -> all.
 * 2. base = OR of member's clearances (incl. @everyone).
 * 3. Apply the relay's (or synced parent category's) @everyone overwrite (deny then allow).
 * 4. Apply OR of all role overwrites for the member's roles (deny then allow).
 * 5. Apply the member overwrite (deny then allow).
 */
export async function computeRelayPermissions(
  db: Db,
  transmitterId: string,
  relayId: string
): Promise<bigint> {
  const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
  if (!relay) return 0n;

  const [beacon] = await db.select().from(beacons).where(eq(beacons.id, relay.beaconId)).limit(1);
  if (!beacon) return 0n;

  const isOwner = beacon.ownerId === transmitterId;

  const [member] = await db
    .select()
    .from(beaconMembers)
    .where(and(eq(beaconMembers.beaconId, relay.beaconId), eq(beaconMembers.transmitterId, transmitterId)))
    .limit(1);

  if (!member && !isOwner) return 0n;

  const beaconClearances: Array<typeof clearances.$inferSelect> = await db
    .select()
    .from(clearances)
    .where(eq(clearances.beaconId, relay.beaconId));

  const assignedIds = new Set((member?.clearanceIds as string[]) || []);
  const activeClearances = beaconClearances.filter((c) => c.position === 0 || assignedIds.has(c.id));

  const base = computeMemberPermissions(activeClearances, isOwner);
  if (hasPermission(base, PERMISSIONS.ADMINISTRATOR)) return base;

  // Resolve which relay's overwrites apply: the relay's own, or its parent category's
  // when `permissionsSynced` is true and it has a parent.
  let overwriteRelayId = relay.id;
  if (relay.permissionsSynced && relay.parentId) {
    overwriteRelayId = relay.parentId;
  }

  const allOverwrites: Array<typeof relayOverwrites.$inferSelect> = await db
    .select()
    .from(relayOverwrites)
    .where(eq(relayOverwrites.relayId, overwriteRelayId));

  const everyoneClearance = beaconClearances.find((c) => c.position === 0);
  let perms = base;

  const everyoneOverwrite = everyoneClearance
    ? allOverwrites.find((o) => o.targetType === 'clearance' && o.targetId === everyoneClearance.id)
    : undefined;
  if (everyoneOverwrite) {
    perms = (perms & ~everyoneOverwrite.denyBits) | everyoneOverwrite.allowBits;
  }

  const roleOverwrites = allOverwrites.filter(
    (o) => o.targetType === 'clearance' && assignedIds.has(o.targetId) && o.targetId !== everyoneClearance?.id
  );
  if (roleOverwrites.length > 0) {
    let roleDeny = 0n;
    let roleAllow = 0n;
    for (const o of roleOverwrites) {
      roleDeny |= o.denyBits;
      roleAllow |= o.allowBits;
    }
    perms = (perms & ~roleDeny) | roleAllow;
  }

  const memberOverwrite = allOverwrites.find((o) => o.targetType === 'transmitter' && o.targetId === transmitterId);
  if (memberOverwrite) {
    perms = (perms & ~memberOverwrite.denyBits) | memberOverwrite.allowBits;
  }

  return perms;
}

/** Transmitter ids that may VIEW the given relay (owner + members whose effective permissions include VIEW_RELAY). */
export async function resolveRelayAudience(db: Db, relayId: string): Promise<string[]> {
  const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
  if (!relay) return [];

  const [beacon] = await db.select().from(beacons).where(eq(beacons.id, relay.beaconId)).limit(1);
  if (!beacon) return [];

  const members: Array<typeof beaconMembers.$inferSelect> = await db
    .select()
    .from(beaconMembers)
    .where(eq(beaconMembers.beaconId, relay.beaconId));

  const audience = new Set<string>([beacon.ownerId]);
  for (const m of members) {
    const perms = await computeRelayPermissions(db, m.transmitterId, relayId);
    if (hasPermission(perms, PERMISSIONS.VIEW_RELAY)) audience.add(m.transmitterId);
  }
  return [...audience];
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
  const perms = await computeRelayPermissions(db, transmitterId, relayId);
  return hasPermission(perms, PERMISSIONS.CONNECT_AUDIO) ? relay.beaconId : null;
}

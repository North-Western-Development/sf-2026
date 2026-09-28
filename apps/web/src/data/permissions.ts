import { PERMISSIONS, computeMemberPermissions, hasPermission } from '@subspace/constants';
import type { SubspaceState } from './store';
import { useStore } from './store';

export { PERMISSIONS };

/** Beacon-level permissions for the signed-in transmitter (owner = all). */
export function beaconPermissions(s: SubspaceState, beaconId: string): bigint {
  const beacon = s.beacons[beaconId];
  const me = s.me;
  if (!beacon || !me) return 0n;
  if (beacon.ownerId === me.id) return PERMISSIONS.ADMINISTRATOR;
  const member = s.members[beaconId]?.[me.id];
  const clearances = s.clearances[beaconId] ?? [];
  const active = clearances.filter((c) => c.position === 0 || member?.clearanceIds.includes(c.id));
  return computeMemberPermissions(active, false);
}

/** Relay-level permissions: server-computed `myPermissions` when present, else beacon-level. */
export function relayPermissions(s: SubspaceState, relayId: string): bigint {
  const relay = s.relays[relayId];
  if (!relay) return 0n;
  if (relay.myPermissions) return BigInt(relay.myPermissions);
  return beaconPermissions(s, relay.beaconId);
}

export const can = (bits: bigint, perm: bigint) => hasPermission(bits, perm);

export const useBeaconCan = (beaconId: string | undefined, perm: bigint) =>
  useStore((s) => (beaconId ? can(beaconPermissions(s, beaconId), perm) : false));

export const useRelayCan = (relayId: string | undefined, perm: bigint) =>
  useStore((s) => (relayId ? can(relayPermissions(s, relayId), perm) : false));

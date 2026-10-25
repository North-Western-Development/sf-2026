import { PERMISSIONS, computeMemberPermissions, hasPermission, restrictPermissions, meetsVerification } from '@subspace/constants';
import type { SubspaceState } from './store';
import { useStore } from './store';

export { PERMISSIONS };

/** My timeout in a beacon (ISO) while it lasts, else null. */
export function myTimeout(s: SubspaceState, beaconId: string): string | null {
  const until = s.me ? s.members[beaconId]?.[s.me.id]?.timeoutUntil : null;
  return until && new Date(until).getTime() > Date.now() ? until : null;
}

/** Why I cannot post in a beacon yet under its verification level (Safety Setup), or null. */
export function verificationPending(s: SubspaceState, beaconId: string): string | null {
  const beacon = s.beacons[beaconId];
  const me = s.me;
  const member = me ? s.members[beaconId]?.[me.id] : undefined;
  if (!beacon || !me || !member || beacon.ownerId === me.id) return null;
  const account = { isEmailVerified: !!me.isEmailVerified, createdAt: me.createdAt ?? 0, is2faEnabled: !!me.is2faEnabled };
  const joined = { joinedAt: member.joinedAt ?? 0, hasClearance: member.clearanceIds.length > 0 };
  if (meetsVerification(beacon.verificationLevel, account, joined)) return null;
  if (!account.isEmailVerified) return 'This beacon needs a verified email before you can transmit. Verify it in User Settings.';
  if (Date.now() - new Date(account.createdAt).getTime() < 5 * 60_000) return 'Your account is too new to transmit here. Try again in a few minutes.';
  if (Date.now() - new Date(joined.joinedAt).getTime() < 10 * 60_000) return 'New members can transmit here after 10 minutes.';
  return 'This beacon needs two-factor authentication on your account before you can transmit.';
}

/** Beacon-level permissions for the signed-in transmitter (owner = all), less a running timeout. */
export function beaconPermissions(s: SubspaceState, beaconId: string): bigint {
  const beacon = s.beacons[beaconId];
  const me = s.me;
  if (!beacon || !me) return 0n;
  if (beacon.ownerId === me.id) return PERMISSIONS.ADMINISTRATOR;
  const member = s.members[beaconId]?.[me.id];
  const clearances = s.clearances[beaconId] ?? [];
  const active = clearances.filter((c) => c.position === 0 || member?.clearanceIds.includes(c.id));
  return restrictPermissions(computeMemberPermissions(active, false), { timeoutUntil: myTimeout(s, beaconId), unverified: !!verificationPending(s, beaconId) });
}

/** Relay-level permissions: server-computed `myPermissions` when present, else beacon-level; a timeout applies either way. */
export function relayPermissions(s: SubspaceState, relayId: string): bigint {
  const relay = s.relays[relayId];
  if (!relay) return 0n;
  if (relay.myPermissions) return restrictPermissions(BigInt(relay.myPermissions), { timeoutUntil: myTimeout(s, relay.beaconId), unverified: !!verificationPending(s, relay.beaconId) });
  return beaconPermissions(s, relay.beaconId);
}

export const can = (bits: bigint, perm: bigint) => hasPermission(bits, perm);

export const useBeaconCan = (beaconId: string | undefined, perm: bigint) =>
  useStore((s) => (beaconId ? can(beaconPermissions(s, beaconId), perm) : false));

export const useRelayCan = (relayId: string | undefined, perm: bigint) =>
  useStore((s) => (relayId ? can(relayPermissions(s, relayId), perm) : false));

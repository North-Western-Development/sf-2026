import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission,
  computeMemberPermissions,
  getHighestRank,
  canModerate,
} from '@subspace/constants';

describe('Clearance & Hierarchy Logic Unit Suite', () => {
  it('correctly calculates bitwise permissions and administrator override', () => {
    // Basic permissions
    const basicBits = DEFAULT_EVERYONE_PERMISSIONS;
    expect(hasPermission(basicBits, PERMISSIONS.VIEW_RELAY)).toBe(true);
    expect(hasPermission(basicBits, PERMISSIONS.SEND_TRANSMISSIONS)).toBe(true);
    expect(hasPermission(basicBits, PERMISSIONS.MANAGE_CLEARANCES)).toBe(false);
    expect(hasPermission(basicBits, PERMISSIONS.KICK_MEMBERS)).toBe(false);
    expect(hasPermission(basicBits, PERMISSIONS.BAN_MEMBERS)).toBe(false);

    // Combining multiple clearances
    const modBits = PERMISSIONS.KICK_MEMBERS | PERMISSIONS.BAN_MEMBERS;
    const combinedBits = computeMemberPermissions([
      { permissions: basicBits },
      { permissions: modBits },
    ]);

    expect(hasPermission(combinedBits, PERMISSIONS.VIEW_RELAY)).toBe(true);
    expect(hasPermission(combinedBits, PERMISSIONS.KICK_MEMBERS)).toBe(true);
    expect(hasPermission(combinedBits, PERMISSIONS.BAN_MEMBERS)).toBe(true);
    expect(hasPermission(combinedBits, PERMISSIONS.MANAGE_CLEARANCES)).toBe(false);

    // Administrator override flag (0x20000000)
    const adminClearance = { permissions: PERMISSIONS.ADMINISTRATOR };
    const adminBits = computeMemberPermissions([adminClearance]);
    expect(hasPermission(adminBits, PERMISSIONS.MANAGE_CLEARANCES)).toBe(true);
    expect(hasPermission(adminBits, PERMISSIONS.BAN_MEMBERS)).toBe(true);
    expect(hasPermission(adminBits, PERMISSIONS.BROADCAST_HOLO_CAST)).toBe(true);

    // Owner override gives full administrator bit
    const ownerBits = computeMemberPermissions([], true);
    expect(hasPermission(ownerBits, PERMISSIONS.MANAGE_CLEARANCES)).toBe(true);
    expect(hasPermission(ownerBits, PERMISSIONS.ADMINISTRATOR)).toBe(true);
  });

  it('determines highest hierarchy rank accurately', () => {
    // No extra roles -> defaults to 0 (@everyone)
    expect(getHighestRank([])).toBe(0);

    // Multiple clearances: returns maximum position
    const roles = [
      { position: 0 },
      { position: 10 },
      { position: 5 },
      { position: 25 },
    ];
    expect(getHighestRank(roles)).toBe(25);

    // Owner has highest rank (999999) regardless of roles
    expect(getHighestRank(roles, true)).toBe(999999);
  });

  it('enforces strict hierarchy moderation rules (actorRank > targetRank)', () => {
    // Rank 5 cannot kick Rank 6
    expect(canModerate(5, 6, false, false)).toBe(false);

    // Rank 5 cannot kick Rank 5 (equal rank rule)
    expect(canModerate(5, 5, false, false)).toBe(false);

    // Rank 5 can kick Rank 4
    expect(canModerate(5, 4, false, false)).toBe(true);

    // Nobody can moderate the owner (even another user with rank 999999)
    expect(canModerate(999999, 999999, false, true)).toBe(false);

    // Owner can moderate anyone except another owner
    expect(canModerate(999999, 50, true, false)).toBe(true);
    expect(canModerate(999999, 0, true, false)).toBe(true);
  });
});

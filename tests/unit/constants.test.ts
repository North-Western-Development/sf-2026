import { describe, it, expect } from 'vitest';
import { TERMINOLOGY, PERMISSIONS, hasPermission, PRESENCE_STATES } from '@subspace/constants';

describe('@subspace/constants Suite', () => {
  it('defines all canonical space domain terminologies', () => {
    expect(TERMINOLOGY.USER).toBe('Transmitter');
    expect(TERMINOLOGY.MESSAGE).toBe('Transmission');
    expect(TERMINOLOGY.SERVER).toBe('Beacon');
    expect(TERMINOLOGY.CHANNEL).toBe('Relay');
    expect(TERMINOLOGY.ROLES).toBe('Clearances');
    expect(TERMINOLOGY.INVISIBLE_PRESENCE).toBe('Ghost Mode');
    expect(TERMINOLOGY.BADGES).toBe('Commendations');
    expect(TERMINOLOGY.E2E_ENCRYPTION).toBe('Quantum Encryption');
    expect(TERMINOLOGY.MESSAGE_REQUEST).toBe('Transmission Request');
    expect(TERMINOLOGY.FORUM_CHANNEL).toBe('Archival Relay');
    expect(TERMINOLOGY.GALLERY_CHANNEL).toBe('Visual Relay');
    expect(TERMINOLOGY.SERVER_FOLDER).toBe('Beacon Cluster');
    expect(TERMINOLOGY.SERVER_LIST).toBe('Beacon List');
  });

  it('correctly evaluates 64-bit bitfield permissions', () => {
    const viewAndSend = PERMISSIONS.VIEW_RELAY | PERMISSIONS.SEND_TRANSMISSIONS;

    expect(hasPermission(viewAndSend, PERMISSIONS.VIEW_RELAY)).toBe(true);
    expect(hasPermission(viewAndSend, PERMISSIONS.SEND_TRANSMISSIONS)).toBe(true);
    expect(hasPermission(viewAndSend, PERMISSIONS.MANAGE_RELAYS)).toBe(false);
    expect(hasPermission(viewAndSend, PERMISSIONS.ADMINISTRATOR)).toBe(false);

    // Administrator bit bypasses all checks
    const adminBits = PERMISSIONS.ADMINISTRATOR;
    expect(hasPermission(adminBits, PERMISSIONS.MANAGE_RELAYS)).toBe(true);
    expect(hasPermission(adminBits, PERMISSIONS.BAN_MEMBERS)).toBe(true);
    expect(hasPermission(adminBits, PERMISSIONS.CONNECT_AUDIO)).toBe(true);
  });

  it('exposes the presence states (Discord-parity dnd plus legacy away)', () => {
    expect(Object.values(PRESENCE_STATES)).toEqual([
      'online',
      'idle',
      'dnd',
      'away',
      'invisible',
      'offline',
    ]);
  });
});

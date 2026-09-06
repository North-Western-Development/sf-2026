import { describe, it, expect } from 'vitest';
import {
  transmitters,
  beacons,
  beaconClusters,
  clearances,
  beaconMembers,
  relays,
  transmissions,
  commendations,
  vaultFiles
} from '@subspace/database';

describe('@subspace/database Schema Suite', () => {
  it('exports all core relational tables', () => {
    expect(transmitters).toBeDefined();
    expect(beacons).toBeDefined();
    expect(beaconClusters).toBeDefined();
    expect(clearances).toBeDefined();
    expect(beaconMembers).toBeDefined();
    expect(relays).toBeDefined();
    expect(transmissions).toBeDefined();
    expect(commendations).toBeDefined();
    expect(vaultFiles).toBeDefined();
  });

  it('contains proper column definitions on transmitters', () => {
    expect(transmitters.username).toBeDefined();
    expect(transmitters.passwordHash).toBeDefined();
    expect(transmitters.displayFont).toBeDefined();
    expect(transmitters.displayColor).toBeDefined();
    expect(transmitters.presence).toBeDefined();
    expect(transmitters.hasAcceptedUploadDisclaimer).toBeDefined();
    expect(transmitters.lastAgreedRulesVersion).toBeDefined();
  });
});

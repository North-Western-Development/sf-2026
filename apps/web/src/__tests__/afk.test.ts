import { describe, it, expect, vi } from 'vitest';

vi.mock('../features/voice/session', () => ({ joinVoice: vi.fn(), useVoice: { getState: () => ({}) } }));
vi.mock('../features/voice/audioPrefs', () => ({ useAudioPrefs: { setState: vi.fn() } }));

const { afkTarget } = await import('../features/voice/afk');

describe('inactive comm-link', () => {
  const base = { relayId: 'voice', afkChannelId: 'afk', afkTimeout: 300 };
  it('moves someone idle past the timeout', () => {
    expect(afkTarget({ ...base, idleMs: 300_000 })).toBe('afk');
  });
  it('leaves active people, people already there, and beacons without one alone', () => {
    expect(afkTarget({ ...base, idleMs: 299_000 })).toBeNull();
    expect(afkTarget({ ...base, relayId: 'afk', idleMs: 900_000 })).toBeNull();
    expect(afkTarget({ ...base, afkChannelId: null, idleMs: 900_000 })).toBeNull();
    expect(afkTarget({ ...base, relayId: null, idleMs: 900_000 })).toBeNull();
  });
});

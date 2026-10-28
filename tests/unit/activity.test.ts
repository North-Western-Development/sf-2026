import { describe, it, expect } from 'vitest';
import { sanitizeActivity, isInstanceImage } from '@subspace/constants';

describe('sanitizeActivity', () => {
  const now = Date.UTC(2026, 9, 27);

  it('keeps a full Rich Presence and drops nothing valid', () => {
    const a = sanitizeActivity(
      {
        type: 'competing',
        name: 'Counter-Strike 2',
        source: 'rpc',
        applicationId: '123456789',
        details: 'Competitive · Mirage',
        state: 'In a match',
        startedAt: now - 60_000,
        endsAt: now + 60_000,
        largeImage: 'https://cdn.example.com/mirage.png',
        smallImage: '/api/v1/embed-proxy?url=x&sig=y',
        party: { size: 2, max: 5 },
        buttons: [{ label: 'Watch', url: 'https://example.com/watch' }],
      },
      now
    );
    expect(a).toMatchObject({ type: 'competing', name: 'Counter-Strike 2', source: 'rpc', applicationId: '123456789', party: { size: 2, max: 5 } });
    expect(a?.smallImage).toBe('/api/v1/embed-proxy?url=x&sig=y');
    expect(a?.buttons).toHaveLength(1);
  });

  it('needs a name, and refuses what could leak or break things', () => {
    expect(sanitizeActivity({ details: 'no name' })).toBeNull();
    expect(sanitizeActivity('Playing')).toBeNull();
    const a = sanitizeActivity(
      {
        name: '  Doom\u0000  ',
        type: 'hacking',
        source: 'evil',
        applicationId: 'abc',
        largeImage: 'http://tracker.example/pixel.png',
        smallImage: 'javascript:alert(1)',
        startedAt: now - 5 * 365 * 24 * 3600_000,
        party: { size: 9, max: 2 },
        buttons: [{ label: 'Login', url: 'http://phish.example' }, { label: 'a', url: 'https://a.example' }, { label: 'b', url: 'https://b.example' }, { label: 'c', url: 'https://c.example' }],
      },
      now
    )!;
    expect(a.name).toBe('Doom');
    expect(a.type).toBe('playing');
    expect(a.source).toBe('detected');
    expect(a).not.toHaveProperty('applicationId');
    expect(a).not.toHaveProperty('largeImage');
    expect(a).not.toHaveProperty('smallImage');
    expect(a).not.toHaveProperty('startedAt');
    expect(a).not.toHaveProperty('party');
    expect(a.buttons?.map((b) => b.label)).toEqual(['a', 'b']);
    expect(sanitizeActivity({ name: 'x'.repeat(500) })!.name).toHaveLength(128);
  });

  it('only treats this instance\'s media and proxy as instance images', () => {
    expect(isInstanceImage('/subspace-media/avatars/1.png')).toBe(true);
    expect(isInstanceImage('/api/v1/embed-proxy?url=a&sig=b')).toBe(true);
    expect(isInstanceImage('/subspace-media/../api/secret')).toBe(false);
    expect(isInstanceImage('//evil.example/x.png')).toBe(false);
    expect(isInstanceImage('https://evil.example/x.png')).toBe(false);
  });
});

describe('detected games', () => {
  it('have unique names and executables, and Steam covers by app id', async () => {
    const { DETECTED_GAMES, steamCoverOf, isDetectedGame } = await import('@subspace/constants');
    const names = DETECTED_GAMES.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    const exes = DETECTED_GAMES.flatMap((g) => g.exe);
    expect(exes.every((e) => e === e.toLowerCase())).toBe(true);
    expect(isDetectedGame('Counter-Strike 2')).toBe(true);
    expect(isDetectedGame('Not A Game')).toBe(false);
    expect(steamCoverOf('Counter-Strike 2')).toBe('https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/library_600x900.jpg');
    expect(steamCoverOf('VALORANT')).toBeUndefined();
  });
});

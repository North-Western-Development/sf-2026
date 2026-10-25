import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, mediaUploads, eq, or } from '@subspace/database';

/** Stickers, the soundboard and GIF favorites. */
describe('Expression', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: 'fd000000-0000-4000-8000-000000000001', username: 'exp_owner' };
  const member = { id: 'fd000000-0000-4000-8000-000000000002', username: 'exp_member' };
  const outsider = { id: 'fd000000-0000-4000-8000-000000000003', username: 'exp_out' };
  const users = [owner, member, outsider];
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: { id: string; username: string }, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  const media = async (u: { id: string }, purpose: string, mime: string) => {
    const url = `/subspace-media/${purpose}/${crypto.randomUUID()}.${mime.split('/')[1]}`;
    await db.insert(mediaUploads).values({ ownerId: u.id, purpose, mimeType: mime, declaredSizeBytes: 100n, storageKey: url.slice(16), publicUrl: url, verified: true });
    return url;
  };
  let beaconId = '';
  let textId = '';
  let voiceId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.GIPHY_API_KEY;
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true });
    beaconId = (await call('POST', '/beacons', owner, { name: 'Expressive', isDiscoverable: true })).json().beacon.id;
    const relays = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays;
    textId = relays.find((r: any) => r.type === 'text').id;
    voiceId = relays.find((r: any) => r.type === 'comm_link').id;
    await call('POST', `/beacons/${beaconId}/join`, member);
  });

  afterAll(async () => {
    if (db) await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await app.close();
  });

  it('adds stickers that members can send, and nobody else can', async () => {
    if (!db) return;
    const url = await media(owner, 'sticker', 'image/png');
    expect((await call('POST', `/beacons/${beaconId}/stickers`, member, { name: 'nope', emoji: '🙂', url })).statusCode).toBe(403);
    expect((await call('POST', `/beacons/${beaconId}/stickers`, owner, { name: 'bad', emoji: '🙂', url: await media(owner, 'avatar', 'image/png') })).statusCode).toBe(400);
    const sticker = (await call('POST', `/beacons/${beaconId}/stickers`, owner, { name: 'Wave', emoji: '👋', url })).json().sticker;
    expect((await call('GET', '/users/@me/stickers', member)).json().packs[0].stickers[0].name).toBe('Wave');

    const sent = await call('POST', `/channels/relay/${textId}/transmissions`, member, { stickerIds: [sticker.id] });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().transmission.stickers).toEqual([{ id: sticker.id, name: 'Wave', url }]);
    // Someone not in the beacon cannot send its stickers, even in their own DMs.
    const link = (await call('POST', '/links', owner, { targetId: member.id })).json().link;
    expect((await call('POST', `/channels/link/${link.id}/transmissions`, outsider, { stickerIds: [sticker.id] })).statusCode).not.toBe(201);

    await call('DELETE', `/beacons/${beaconId}/stickers/${sticker.id}`, owner);
    const history = (await call('GET', `/channels/relay/${textId}/transmissions?limit=1`, owner)).json().transmissions;
    expect(history[0].stickers[0].name).toBe('Wave');
  });

  it('keeps a soundboard and plays to comm-links with permission and a cooldown', async () => {
    if (!db) return;
    const url = await media(owner, 'sound', 'audio/ogg');
    expect((await call('POST', `/beacons/${beaconId}/sounds`, owner, { name: 'Bad', url: await media(owner, 'sticker', 'image/png') })).statusCode).toBe(400);
    const sound = (await call('POST', `/beacons/${beaconId}/sounds`, owner, { name: 'Horn', emoji: '📯', url, volume: 60 })).json().sound;
    expect((await call('GET', `/beacons/${beaconId}/sounds`, member)).json().sounds[0]).toMatchObject({ name: 'Horn', volume: 60 });

    expect((await call('POST', `/relays/${textId}/soundboard`, member, { defaultSound: 'ping' })).statusCode).toBe(404);
    expect((await call('POST', `/relays/${voiceId}/soundboard`, member, { soundId: sound.id })).statusCode).toBe(200);
    expect((await call('POST', `/relays/${voiceId}/soundboard`, member, { defaultSound: 'ping' })).statusCode).toBe(429);
    expect((await call('POST', `/relays/${voiceId}/soundboard`, outsider, { defaultSound: 'ping' })).statusCode).toBe(403);
    expect((await call('POST', `/relays/${voiceId}/soundboard`, owner, { defaultSound: 'nope' })).statusCode).toBe(400);
  });

  it('says when GIF search is not set up, and keeps favorites either way', async () => {
    if (!db) return;
    expect((await call('GET', '/gifs/trending', member)).json().code).toBe('GIFS_NOT_CONFIGURED');
    const fav = (await call('POST', '/users/@me/gif-favorites', member, { url: 'https://media.example/a.gif', previewUrl: 'https://media.example/a-small.gif', width: 200, height: 100 })).json().favorite;
    await call('POST', '/users/@me/gif-favorites', member, { url: 'https://media.example/a.gif', previewUrl: 'https://media.example/a-small.gif' });
    expect((await call('GET', '/users/@me/gif-favorites', member)).json().favorites).toHaveLength(1);
    expect((await call('POST', '/users/@me/gif-favorites', member, { url: 'javascript:alert(1)', previewUrl: 'x' })).statusCode).toBe(400);
    await call('DELETE', `/users/@me/gif-favorites/${fav.id}`, owner);
    expect((await call('GET', '/users/@me/gif-favorites', member)).json().favorites).toHaveLength(1);
    await call('DELETE', `/users/@me/gif-favorites/${fav.id}`, member);
    expect((await call('GET', '/users/@me/gif-favorites', member)).json().favorites).toHaveLength(0);
  });
});

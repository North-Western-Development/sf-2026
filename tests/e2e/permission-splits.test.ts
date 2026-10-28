import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { PERMISSIONS, withSplits, DEFAULT_EVERYONE_PERMISSIONS } from '@subspace/constants';
import { transmitters, beacons, soundboardSounds, beaconEmojis, beaconStickers, eq, or } from '@subspace/database';

/** The finer permissions split off broader ones, and private threads. */
describe('Permission splits', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: '397172535496146945', username: 'split_owner' };
  const helper = { id: '397172535496146946', username: 'split_helper' };
  const pleb = { id: '397172535496146947', username: 'split_pleb' };
  const users = [owner, helper, pleb];
  const auth = (u: typeof owner) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: typeof owner, payload?: unknown) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  let beaconId = '';
  let general = '';
  let comm = '';
  let role = '';
  let everyone = '';
  const give = async (perms: bigint) => call('PATCH', `/beacons/${beaconId}/clearances/${role}`, owner, { permissions: perms.toString() });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true, createdAt: new Date(Date.now() - 30 * 86_400_000) });
    beaconId = (await call('POST', '/beacons', owner, { name: 'Splits', isDiscoverable: true })).json().beacon.id;
    const relays = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays;
    general = relays.find((r: any) => r.type === 'text').id;
    comm = relays.find((r: any) => r.type === 'comm_link').id;
    everyone = (await call('GET', `/beacons/${beaconId}/clearances`, owner)).json().clearances.find((c: any) => c.position === 0).id;
    role = (await call('POST', `/beacons/${beaconId}/clearances`, owner, { name: 'Helpers', position: 1, permissions: '0' })).json().clearance.id;
    for (const u of [helper, pleb]) await call('POST', `/beacons/${beaconId}/join`, u);
    await call('POST', `/beacons/${beaconId}/clearances/members/${helper.id}/assign`, owner, { clearanceId: role, action: 'add' });
  });

  afterAll(async () => {
    if (db) {
      await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await app.close();
  });

  it('carries every split to the holders of the old permission, and gives @everyone the new defaults', () => {
    expect(withSplits(PERMISSIONS.BROADCAST_HOLO_CAST) & PERMISSIONS.SHARE_SCREEN).toBe(PERMISSIONS.SHARE_SCREEN);
    expect(withSplits(PERMISSIONS.MANAGE_BEACON) & (PERMISSIONS.MANAGE_INVITES | PERMISSIONS.VIEW_INSIGHTS)).toBe(PERMISSIONS.MANAGE_INVITES | PERMISSIONS.VIEW_INSIGHTS);
    expect(withSplits(PERMISSIONS.SEND_TRANSMISSIONS) & PERMISSIONS.SEND_IN_THREADS).toBe(PERMISSIONS.SEND_IN_THREADS);
    expect(withSplits(PERMISSIONS.VIEW_RELAY)).toBe(PERMISSIONS.VIEW_RELAY);
    for (const p of [PERMISSIONS.CREATE_POLLS, PERMISSIONS.SEND_VOICE_MESSAGES, PERMISSIONS.USE_VOICE_ACTIVITY, PERMISSIONS.REQUEST_TO_SPEAK, PERMISSIONS.USE_EXTERNAL_GLYPHS]) {
      expect(DEFAULT_EVERYONE_PERMISSIONS & p).toBe(p);
    }
  });

  it('Video and Holo-Cast are separate in the voice token', async () => {
    if (!db) return;
    const sources = async () => JSON.parse(Buffer.from((await call('POST', `/relays/${comm}/comm-link/token`, helper)).json().token.split('.')[1], 'base64url').toString()).video.canPublishSources;
    expect(await sources()).toEqual(['microphone']);
    await give(PERMISSIONS.BROADCAST_HOLO_CAST);
    expect(await sources()).toEqual(['microphone', 'camera']);
    await give(PERMISSIONS.SHARE_SCREEN);
    expect(await sources()).toEqual(['microphone', 'screen_share', 'screen_share_audio']);
  });

  it('Create Relays, Manage Invites, View Insights and Deafen Members stand on their own', async () => {
    if (!db) return;
    await give(0n);
    expect((await call('POST', `/beacons/${beaconId}/relays`, helper, { name: 'nope', type: 'text' })).statusCode).toBe(403);
    await give(PERMISSIONS.CREATE_RELAYS);
    const made = (await call('POST', `/beacons/${beaconId}/relays`, helper, { name: 'mine', type: 'text' })).json().relay;
    expect(made.name).toBe('mine');
    // Creating is not editing.
    expect((await call('PATCH', `/beacons/${beaconId}/relays/${made.id}`, helper, { name: 'renamed' })).statusCode).toBe(403);

    // Invites: your own, or everyone's with Manage Invites.
    await call('POST', `/beacons/${beaconId}/invites`, owner, {});
    const list = async () => (await call('GET', `/beacons/${beaconId}/invites`, helper)).json().invites ?? [];
    expect((await list()).length).toBe(0);
    await give(PERMISSIONS.MANAGE_INVITES);
    expect((await list()).length).toBeGreaterThan(0);

    expect((await call('GET', `/beacons/${beaconId}/insights`, helper)).statusCode).toBe(403);
    await give(PERMISSIONS.VIEW_INSIGHTS);
    expect((await call('GET', `/beacons/${beaconId}/insights`, helper)).statusCode).toBe(200);

    await give(PERMISSIONS.MUTE_MEMBERS);
    const redis = (app as any).redis;
    await redis.hset('voice:relay', pleb.id, comm);
    expect((await call('PATCH', `/beacons/${beaconId}/voice-states/${pleb.id}`, helper, { deafen: true })).json().code).toBe('MISSING_PERMISSIONS');
    expect((await call('PATCH', `/beacons/${beaconId}/voice-states/${pleb.id}`, helper, { mute: true })).json().serverMuted).toBe(true);
    await give(PERMISSIONS.DEAFEN_MEMBERS);
    expect((await call('PATCH', `/beacons/${beaconId}/voice-states/${pleb.id}`, helper, { deafen: true, mute: false })).json().code).toBe('MISSING_PERMISSIONS');
    expect((await call('PATCH', `/beacons/${beaconId}/voice-states/${pleb.id}`, helper, { deafen: false })).json().serverDeafened).toBe(false);
    await redis.hdel('voice:relay', pleb.id);
  });

  it('Create Expressions edits only your own; Manage Expressions edits anyone’s', async () => {
    if (!db) return;
    const sound = { name: 'Boop', url: 'https://example.com/boop.mp3' };
    await give(0n);
    // @everyone has Create Expressions by default: take it away to see the difference.
    const perms = (await call('GET', `/beacons/${beaconId}/clearances`, owner)).json().clearances.find((c: any) => c.id === everyone).permissions;
    await call('PATCH', `/beacons/${beaconId}/clearances/${everyone}`, owner, { permissions: (BigInt(perms) & ~PERMISSIONS.CREATE_EXPRESSIONS).toString() });
    expect((await call('POST', `/beacons/${beaconId}/sounds`, helper, sound)).statusCode).toBe(403);
    await give(PERMISSIONS.CREATE_EXPRESSIONS);
    // Past the permission check (the URL is not a real upload here).
    expect((await call('POST', `/beacons/${beaconId}/sounds`, helper, sound)).json().code).toBe('INVALID_MEDIA_URL');
    const [mine, theirs] = await db
      .insert(soundboardSounds)
      .values([
        { beaconId, name: 'Mine', url: sound.url, creatorId: helper.id },
        { beaconId, name: 'Owner', url: sound.url, creatorId: owner.id },
      ])
      .returning();
    expect((await call('PATCH', `/beacons/${beaconId}/sounds/${mine.id}`, helper, { name: 'Mine' })).statusCode).toBe(200);
    expect((await call('DELETE', `/beacons/${beaconId}/sounds/${theirs.id}`, helper)).statusCode).toBe(403);
    await give(PERMISSIONS.MANAGE_GLYPHS);
    expect((await call('DELETE', `/beacons/${beaconId}/sounds/${theirs.id}`, helper)).statusCode).toBe(200);
    await call('PATCH', `/beacons/${beaconId}/clearances/${everyone}`, owner, { permissions: perms });
  });

  it('clearance mentions need the clearance to be mentionable, or Mention All Clearances', async () => {
    if (!db) return;
    await give(0n);
    const send = async (u: typeof owner) => (await call('POST', `/channels/relay/${general}/transmissions`, u, { content: `hey <@&${role}>` })).json().transmission;
    expect((await send(pleb)).mentionRoles ?? []).toEqual([]);
    await call('PATCH', `/beacons/${beaconId}/clearances/${role}`, owner, { mentionable: true });
    expect((await send(pleb)).mentionRoles).toEqual([role]);
    await call('PATCH', `/beacons/${beaconId}/clearances/${role}`, owner, { mentionable: false });
    expect((await send(owner)).mentionRoles).toEqual([role]);
  });

  it('private threads: only members and Manage Threads see them; posting in threads is its own permission', async () => {
    if (!db) return;
    await give(0n);
    const t = (await call('POST', `/relays/${general}/threads`, owner, { name: 'Secret', private: true, members: [helper.id] })).json().thread;
    expect(t.isPrivate).toBe(true);
    const titles = async (u: typeof owner) => (await call('GET', `/relays/${general}/threads`, u)).json().threads.map((x: any) => x.title);
    expect(await titles(helper)).toContain('Secret');
    expect(await titles(pleb)).not.toContain('Secret');
    expect((await call('GET', `/channels/thread/${t.id}/transmissions`, pleb)).statusCode).toBe(404);
    expect((await call('POST', `/channels/thread/${t.id}/transmissions`, helper, { content: 'psst' })).statusCode).toBe(201);
    // Search does not reach into it.
    const found = async (u: typeof owner) => (await call('GET', `/search/transmissions?q=psst&beaconId=${beaconId}`, u)).json().transmissions ?? [];
    expect((await found(helper)).length).toBe(1);
    expect(await found(pleb)).toEqual([]);

    // Members add others; Manage Threads sees it without being added.
    expect((await call('PUT', `/relays/${general}/threads/${t.id}/members/${pleb.id}`, helper)).json().added).toBe(true);
    expect(await titles(pleb)).toContain('Secret');
    await call('DELETE', `/relays/${general}/threads/${t.id}/members/${pleb.id}`, pleb);
    expect(await titles(pleb)).not.toContain('Secret');

    // Send Transmissions in Threads, separately from Send Transmissions.
    const pub = (await call('POST', `/relays/${general}/threads`, owner, { name: 'Open' })).json().thread;
    const perms = (await call('GET', `/beacons/${beaconId}/clearances`, owner)).json().clearances.find((c: any) => c.id === everyone).permissions;
    await call('PATCH', `/beacons/${beaconId}/clearances/${everyone}`, owner, { permissions: (BigInt(perms) & ~PERMISSIONS.SEND_IN_THREADS).toString() });
    expect((await call('POST', `/channels/thread/${pub.id}/transmissions`, pleb, { content: 'hi' })).statusCode).toBe(403);
    expect((await call('POST', `/channels/relay/${general}/transmissions`, pleb, { content: 'hi' })).statusCode).toBe(201);
    // Locking needs Manage Threads.
    expect((await call('PATCH', `/relays/${general}/threads/${pub.id}`, helper, { isLocked: true })).statusCode).toBe(403);
    await give(PERMISSIONS.MANAGE_THREADS);
    expect((await call('PATCH', `/relays/${general}/threads/${pub.id}`, helper, { isLocked: true })).json().thread.isLocked).toBe(true);
    await call('PATCH', `/beacons/${beaconId}/clearances/${everyone}`, owner, { permissions: perms });
    expect((await call('POST', `/relays/${general}/threads`, pleb, { name: 'P', private: true })).statusCode).toBe(201);
    expect((await call('POST', `/relays/${general}/threads`, pleb, { name: 'P', private: true, starterTransmissionId: t.id })).json().code).toBe('PRIVATE_FROM_TRANSMISSION');
  });

  it('slowmode holds members back between transmissions unless they can bypass it', async () => {
    if (!db) return;
    await give(0n);
    expect((await call('PATCH', `/beacons/${beaconId}/relays/${general}`, owner, { slowmodeSeconds: 7 })).json().code).toBe('INVALID_SLOWMODE');
    await call('PATCH', `/beacons/${beaconId}/relays/${general}`, owner, { slowmodeSeconds: 30 });
    const send = (u: typeof owner) => call('POST', `/channels/relay/${general}/transmissions`, u, { content: 'slow down' });
    expect((await send(pleb)).statusCode).toBe(201);
    const held = (await send(pleb)).json();
    expect(held).toMatchObject({ code: 'SLOWMODE' });
    expect(held.retryAfter).toBeGreaterThan(25);
    await give(PERMISSIONS.BYPASS_SLOWMODE);
    expect((await send(helper)).statusCode).toBe(201);
    expect((await send(helper)).statusCode).toBe(201);
    await call('PATCH', `/beacons/${beaconId}/relays/${general}`, owner, { slowmodeSeconds: 0 });
    await (app as any).redis.del(`slowmode:${general}:${pleb.id}`);
  });

  /** @everyone's permissions without some bits, for the duration of `run`. */
  async function withoutForEveryone(bits: bigint, run: () => Promise<void>) {
    const perms = (await call('GET', `/beacons/${beaconId}/clearances`, owner)).json().clearances.find((c: any) => c.id === everyone).permissions;
    await call('PATCH', `/beacons/${beaconId}/clearances/${everyone}`, owner, { permissions: (BigInt(perms) & ~bits).toString() });
    try {
      await run();
    } finally {
      await call('PATCH', `/beacons/${beaconId}/clearances/${everyone}`, owner, { permissions: perms });
    }
  }

  it('polls: posting needs Create Polls; members vote, change votes, and the author ends it', async () => {
    if (!db) return;
    const poll = { question: 'Raid night?', answers: [{ text: 'Friday' }, { text: 'Saturday' }], durationHours: 24 };
    await withoutForEveryone(PERMISSIONS.CREATE_POLLS, async () => {
      expect((await call('POST', `/channels/relay/${general}/transmissions`, pleb, { poll })).json().code).toBe('MISSING_PERMISSIONS');
    });
    const t = (await call('POST', `/channels/relay/${general}/transmissions`, pleb, { poll })).json().transmission;
    expect(t.poll).toMatchObject({ question: 'Raid night?', allowMultiselect: false, ended: false, totalVoters: 0 });
    const votes = `/channels/relay/${general}/transmissions/${t.id}/poll/votes`;
    expect((await call('PUT', votes, helper, { answerIds: [1, 2] })).json().code).toBe('SINGLE_ANSWER');
    expect((await call('PUT', votes, helper, { answerIds: [2] })).json().poll).toMatchObject({ myVotes: [2], totalVoters: 1 });
    expect((await call('PUT', votes, owner, { answerIds: [2] })).json().poll.answers.map((a: any) => a.votes)).toEqual([0, 2]);
    expect((await call('PUT', votes, helper, { answerIds: [1] })).json().poll.answers.map((a: any) => a.votes)).toEqual([1, 1]);
    // Only its author (or Manage Transmissions) ends it.
    expect((await call('POST', `/channels/relay/${general}/transmissions/${t.id}/poll/end`, helper)).statusCode).toBe(403);
    expect((await call('POST', `/channels/relay/${general}/transmissions/${t.id}/poll/end`, pleb)).json().poll.ended).toBe(true);
    expect((await call('PUT', votes, owner, { answerIds: [1] })).json().code).toBe('POLL_ENDED');
  });

  it('voice messages need Send Voice Messages and one audio attachment on its own', async () => {
    if (!db) return;
    const fake = '978275694148452352';
    await withoutForEveryone(PERMISSIONS.SEND_VOICE_MESSAGES, async () => {
      expect((await call('POST', `/channels/relay/${general}/transmissions`, pleb, { attachmentIds: [fake], voiceMessage: { durationMs: 1200 } })).json().code).toBe('MISSING_PERMISSIONS');
    });
    expect((await call('POST', `/channels/relay/${general}/transmissions`, pleb, { content: 'and words', attachmentIds: [fake], voiceMessage: { durationMs: 1200 } })).json().code).toBe('INVALID_VOICE_MESSAGE');
  });

  it('glyphs and stickers from other beacons need Use External Glyphs / Stickers; unusable glyphs turn to text', async () => {
    if (!db) return;
    const other = (await call('POST', '/beacons', pleb, { name: 'Elsewhere' })).json().beacon.id;
    const [glyph] = await db.insert(beaconEmojis).values({ beaconId: other, name: 'wave', url: 'https://example.com/wave.png', uploaderId: pleb.id }).returning();
    const [sticker] = await db.insert(beaconStickers).values({ beaconId: other, name: 'Hi', emoji: '👋', url: 'https://example.com/hi.png', creatorId: pleb.id }).returning();
    const token = `<:wave:${glyph.id}>`;
    const send = (body: object) => call('POST', `/channels/relay/${general}/transmissions`, pleb, body);
    await withoutForEveryone(PERMISSIONS.USE_EXTERNAL_GLYPHS | PERMISSIONS.USE_EXTERNAL_STICKERS, async () => {
      expect((await send({ content: `hi ${token}` })).json().transmission.content).toBe('hi :wave:');
      expect((await send({ stickerIds: [sticker.id] })).json().code).toBe('EXTERNAL_STICKER');
    });
    expect((await send({ content: `hi ${token}` })).json().transmission.content).toBe(`hi ${token}`);
    expect((await send({ stickerIds: [sticker.id] })).statusCode).toBe(201);
    // Not a member of the glyph's beacon: never.
    expect((await call('POST', `/channels/relay/${general}/transmissions`, helper, { content: token })).json().transmission.content).toBe(':wave:');
    await db.delete(beacons).where(eq(beacons.id, other));
  });

  it('raising a hand on a Stage needs Request to Speak', async () => {
    if (!db) return;
    const stage = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'Talks', type: 'stage' })).json().relay.id;
    const redis = (app as any).redis;
    await redis.hset('voice:relay', owner.id, stage);
    await redis.hset('voice:relay', pleb.id, stage);
    await call('POST', `/relays/${stage}/stage`, owner, { topic: 'AMA' });
    await withoutForEveryone(PERMISSIONS.REQUEST_TO_SPEAK, async () => {
      expect((await call('POST', `/relays/${stage}/stage/hand`, pleb, { raised: true })).json().code).toBe('MISSING_PERMISSIONS');
    });
    expect((await call('POST', `/relays/${stage}/stage/hand`, pleb, { raised: true })).json().stage.requests).toEqual([pleb.id]);
    await redis.hdel('voice:relay', owner.id, pleb.id);
    await redis.del(`stage:${stage}`);
  });
});

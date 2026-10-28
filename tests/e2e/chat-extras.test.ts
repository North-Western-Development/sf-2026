import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, transmissionRequests, pointToPointLinks, eq, or } from '@subspace/database';

/** Threads in text relays, forwarding, the Inbox's mentions, and spam requests. */
describe('Chat extras', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: '345269005355974657', username: 'chx_owner' };
  const pilot = { id: '345269005355974658', username: 'chx_pilot' };
  const stranger = { id: '345269005355974659', username: 'chx_stranger' };
  const users = [owner, pilot, stranger];
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: { id: string; username: string }, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  const send = (u: typeof owner, relayId: string, content: string) => call('POST', `/channels/relay/${relayId}/transmissions`, u, { content });
  let beaconId = '';
  let textId = '';
  let secretId = '';
  let roleId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) {
      await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true, createdAt: new Date(u === stranger ? Date.now() : Date.now() - 30 * 86_400_000) });
    }
    beaconId = (await call('POST', '/beacons', owner, { name: 'Chatty', isDiscoverable: true })).json().beacon.id;
    const relays = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays;
    textId = relays.find((r: any) => r.type === 'text').id;
    secretId = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'secret', type: 'text' })).json().relay.id;
    const everyone = (await call('GET', `/beacons/${beaconId}/clearances`, owner)).json().clearances.find((c: any) => c.position === 0);
    await call('PUT', `/beacons/${beaconId}/relays/${secretId}/overwrites/${everyone.id}`, owner, { targetType: 'clearance', allow: '0', deny: '1' });
    roleId = (await call('POST', `/beacons/${beaconId}/clearances`, owner, { name: 'Pilots', position: 1, permissions: '0' })).json().clearance.id;
    await call('POST', `/beacons/${beaconId}/join`, pilot);
    await call('POST', `/beacons/${beaconId}/clearances/members/${pilot.id}/assign`, owner, { clearanceId: roleId, action: 'add' });
    await call('POST', `/beacons/${beaconId}/join`, stranger);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
      await db.delete(pointToPointLinks).where(or(...users.map((u) => eq(pointToPointLinks.transmitter1Id, u.id))));
    }
    await app.close();
  });

  it('starts threads from transmissions or on their own, and counts their messages', async () => {
    if (!db) return;
    const starter = (await send(pilot, textId, 'what do we name the ship?')).json().transmission;
    const t = (await call('POST', `/relays/${textId}/threads`, pilot, { name: 'Ship names', starterTransmissionId: starter.id })).json().thread;
    expect((await call('POST', `/relays/${textId}/threads`, pilot, { name: 'again', starterTransmissionId: starter.id })).json().code).toBe('THREAD_EXISTS');
    await call('POST', `/channels/thread/${t.id}/transmissions`, owner, { content: 'The Wanderer' });
    await call('POST', `/channels/thread/${t.id}/transmissions`, pilot, { content: 'Starling' });
    // The thread's messages stay out of the relay, and the starter carries the thread.
    const history = (await call('GET', `/channels/relay/${textId}/transmissions?limit=50`, owner)).json().transmissions;
    expect(history.map((m: any) => m.content)).not.toContain('Starling');
    expect(history.find((m: any) => m.id === starter.id).thread).toMatchObject({ id: t.id, title: 'Ship names', messageCount: 2 });

    // A thread with no starter posts a line in the relay.
    const loose = (await call('POST', `/relays/${textId}/threads`, owner, { name: 'Off topic' })).json().thread;
    const last = (await call('GET', `/channels/relay/${textId}/transmissions?limit=1`, owner)).json().transmissions[0];
    expect(last.type).toBe('system_thread');
    expect(JSON.parse(last.content)).toMatchObject({ threadId: loose.id, name: 'Off topic' });
    expect((await call('GET', `/relays/${textId}/threads`, pilot)).json().threads.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Ship names', 'Off topic']));

    // Only moderators lock; locked threads stop members.
    expect((await call('PATCH', `/relays/${textId}/threads/${t.id}`, pilot, { isLocked: true })).statusCode).toBe(403);
    await call('PATCH', `/relays/${textId}/threads/${t.id}`, owner, { isLocked: true });
    expect((await call('POST', `/channels/thread/${t.id}/transmissions`, pilot, { content: 'hello?' })).statusCode).toBe(403);
    // A member cannot see threads of a relay they cannot see.
    expect((await call('GET', `/relays/${secretId}/threads`, pilot)).statusCode).toBe(404);
  });

  it('forwards a snapshot to places the forwarder can send, never from places they cannot read', async () => {
    if (!db) return;
    const original = (await send(owner, textId, 'Forward me, please')).json().transmission;
    const hidden = (await send(owner, secretId, 'top secret')).json().transmission;
    const link = (await call('POST', '/links', pilot, { targetId: owner.id })).json().link;

    const res = await call('POST', `/transmissions/${original.id}/forward`, pilot, { targets: [{ channelType: 'link', channelId: link.id }], comment: 'look at this' });
    expect(res.statusCode).toBe(201);
    const fwd = res.json().transmissions[0];
    expect(fwd).toMatchObject({ content: 'look at this', forwarded: { content: 'Forward me, please', source: { channelType: 'relay', channelId: textId, name: 'general', transmissionId: original.id } } });

    expect((await call('POST', `/transmissions/${hidden.id}/forward`, pilot, { targets: [{ channelType: 'link', channelId: link.id }] })).statusCode).toBe(404);
    expect((await call('POST', `/transmissions/${original.id}/forward`, pilot, { targets: [{ channelType: 'relay', channelId: secretId }] })).statusCode).not.toBe(201);
    // Forwarding a forward keeps the original.
    const again = (await call('POST', `/transmissions/${fwd.id}/forward`, owner, { targets: [{ channelType: 'relay', channelId: textId }] })).json().transmissions[0];
    expect(again.forwarded.content).toBe('Forward me, please');
  });

  it('lists mentions by name, by clearance and @everyone, but not from relays you cannot read', async () => {
    if (!db) return;
    await send(owner, textId, `<@${pilot.id}> direct ping`);
    await send(owner, textId, `<@&${roleId}> role ping`);
    await send(owner, textId, '@everyone big news');
    await send(owner, secretId, `<@${pilot.id}> you cannot see this`);
    await send(owner, textId, 'not for you');
    const mentions = (await call('GET', '/users/@me/mentions', pilot)).json().mentions;
    const texts = mentions.map((m: any) => m.transmission.content);
    expect(texts).toEqual(expect.arrayContaining([`<@${pilot.id}> direct ping`, `<@&${roleId}> role ping`, '@everyone big news']));
    expect(texts).not.toContain(`<@${pilot.id}> you cannot see this`);
    expect(texts).not.toContain('not for you');
    expect(mentions[0].channel).toMatchObject({ channelType: 'relay', name: 'general', beaconName: 'Chatty' });
    const noEveryone = (await call('GET', '/users/@me/mentions?everyone=false&roles=false', pilot)).json().mentions.map((m: any) => m.transmission.content);
    expect(noEveryone).toEqual([`<@${pilot.id}> direct ping`]);
  });

  it('sends a brand-new account’s link-bearing request to Spam, quietly, until marked not spam', async () => {
    if (!db) return;
    await db.delete(transmissionRequests).where(eq(transmissionRequests.senderId, stranger.id));
    const sent = await call('POST', `/links/${pilot.id}/transmissions`, stranger, { content: 'free stuff at https://scam.example' });
    expect(sent.json().request.isSpam).toBe(true);
    expect((await call('GET', '/requests', pilot)).json().requests).toHaveLength(0);
    const spam = (await call('GET', '/requests?spam=true', pilot)).json().requests;
    expect(spam).toHaveLength(1);
    await call('POST', `/requests/${spam[0].id}/not-spam`, pilot);
    expect((await call('GET', '/requests', pilot)).json().requests).toHaveLength(1);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, oauthApps, devTeams, staffAuditLog, eq, inArray } from '@subspace/database';

/** Development teams, verified bots and the Add App rule, and announcement relays that others follow. */
describe('Teams, verified bots and announcement relays', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: '801756946623496001', username: 'ta_owner' };
  const dev = { id: '801756946623496002', username: 'ta_dev' };
  const viewer = { id: '801756946623496003', username: 'ta_viewer' };
  const stranger = { id: '801756946623496004', username: 'ta_stranger' };
  const root = { id: '801756946623496005', username: 'ta_root' };
  const people = [owner, dev, viewer, stranger, root];
  const ids = people.map((p) => p.id);
  const call = (u: { id: string; username: string }, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: { authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` }, payload: payload as any });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(inArray(beacons.ownerId, ids));
    await db.delete(oauthApps).where(inArray(oauthApps.ownerId, ids));
    await db.delete(transmitters).where(inArray(transmitters.id, ids));
    await db.insert(transmitters).values(
      people.map((p) => ({ id: p.id, username: p.username, discriminator: '0420', email: `${p.username}@subspace.test`, passwordHash: 'x', displayName: p.username, isEmailVerified: true, staffRank: p === root ? 3 : 0 }))
    );
  });

  afterAll(async () => {
    if (db) {
      await db.delete(staffAuditLog).where(inArray(staffAuditLog.actorId, ids));
      await db.delete(beacons).where(inArray(beacons.ownerId, ids));
      await db.delete(devTeams).where(inArray(devTeams.ownerId, ids));
      await db.delete(oauthApps).where(inArray(oauthApps.ownerId, ids));
      await db.delete(transmitters).where(inArray(transmitters.id, ids));
    }
    await app.close();
  });

  let appId = '';
  let teamId = '';
  let botUserId = '';
  let labId = '';

  it('a team shares an application, as each member’s role allows', async () => {
    if (!db) return;
    appId = (await call(owner, 'POST', '/applications', { name: 'Team Bot' })).json().application.id;
    botUserId = (await call(owner, 'POST', `/applications/${appId}/bot`)).json().bot.userId;
    teamId = (await call(owner, 'POST', '/teams', { name: 'Orbital Labs' })).json().team.id;

    // Invitations: nobody joins until they accept.
    expect((await call(owner, 'POST', `/teams/${teamId}/members`, { username: dev.username, discriminator: '0420', role: 'developer' })).statusCode).toBe(201);
    await call(owner, 'POST', `/teams/${teamId}/members`, { username: viewer.username, discriminator: '0420', role: 'read_only' });
    expect((await call(owner, 'POST', `/teams/${teamId}/members`, { username: 'nobody_here', discriminator: '0420', role: 'developer' })).statusCode).toBe(404);
    expect((await call(dev, 'GET', '/teams')).json()).toMatchObject({ teams: [], invitations: [{ teamId, name: 'Orbital Labs', role: 'developer', owner: owner.username }] });

    // Into the team (its owner is an admin of it, as the owner).
    expect((await call(owner, 'POST', `/applications/${appId}/team`, { teamId })).statusCode).toBe(200);
    expect((await call(dev, 'GET', `/applications/${appId}/bot`)).statusCode).toBe(404);
    await call(dev, 'POST', `/teams/${teamId}/accept`);
    await call(viewer, 'POST', `/teams/${teamId}/accept`);

    const devApps = (await call(dev, 'GET', '/applications')).json().applications;
    expect(devApps).toEqual([expect.objectContaining({ id: appId, teamId, role: 'developer' })]);
    expect((await call(dev, 'PATCH', `/applications/${appId}`, { description: 'Edited by a developer' })).statusCode).toBe(200);
    expect((await call(dev, 'POST', `/applications/${appId}/secret`)).statusCode).toBe(200);
    expect((await call(dev, 'DELETE', `/applications/${appId}`)).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(dev, 'POST', `/teams/${teamId}/members`, { username: stranger.username, discriminator: '0420', role: 'read_only' })).json().code).toBe('TEAM_ROLE_TOO_LOW');

    // Read-only: sees it, changes nothing, gets no secrets.
    expect((await call(viewer, 'GET', `/applications/${appId}/bot`)).statusCode).toBe(200);
    expect((await call(viewer, 'PATCH', `/applications/${appId}/bot`, { isPublic: true })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(viewer, 'POST', `/applications/${appId}/secret`)).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(stranger, 'GET', `/applications/${appId}/bot`)).statusCode).toBe(404);

    // The owner makes the viewer a developer; the viewer leaves on their own.
    const team = (await call(owner, 'PATCH', `/teams/${teamId}/members/${viewer.id}`, { role: 'developer' })).json().team;
    expect(team.members.find((m: any) => m.id === viewer.id)).toMatchObject({ role: 'developer', pending: false });
    expect((await call(viewer, 'DELETE', `/teams/${teamId}/members/${viewer.id}`)).statusCode).toBe(204);
    expect((await call(viewer, 'GET', '/applications')).json().applications).toEqual([]);
  });

  it('Add App only for public bots, or for the bot’s own developers', async () => {
    if (!db) return;
    const beaconId = (labId = (await call(dev, 'POST', '/beacons', { name: 'Dev Lab' })).json().beacon.id);
    // Private: its team developer may add it, a stranger may not, and the profile card says so.
    expect((await call(dev, 'POST', `/beacons/${beaconId}/bots`, { appId, permissions: '0' })).statusCode).toBe(201);
    expect((await call(stranger, 'GET', `/users/${botUserId}/profile`)).json().application).toMatchObject({ id: appId, isPublic: false, canAdd: false });
    expect((await call(dev, 'GET', `/users/${botUserId}/profile`)).json().application.canAdd).toBe(true);
    expect((await call(stranger, 'GET', `/oauth2/applications/${appId}`)).json().application.bot.canAdd).toBe(false);
    await call(owner, 'PATCH', `/applications/${appId}/bot`, { isPublic: true });
    expect((await call(stranger, 'GET', `/users/${botUserId}/profile`)).json().application.canAdd).toBe(true);
  });

  it('staff verify a bot: the check on its APP tag, everywhere it shows', async () => {
    if (!db) return;
    expect((await call(stranger, 'GET', `/users/${botUserId}/profile`)).json().user).toMatchObject({ botKind: 'bot' });
    expect((await call(root, 'PATCH', `/console/transmitters/${botUserId}/verified`, { verified: true })).statusCode).toBe(200);
    expect((await call(stranger, 'GET', `/users/${botUserId}/profile`)).json().user).toMatchObject({ botKind: 'bot', botVerified: true });
    const members = (await call(dev, 'GET', `/beacons/${labId}/members`)).json().members;
    expect(members.find((m: any) => m.user.id === botUserId).user.botVerified).toBe(true);
    // People never carry it.
    expect(members.find((m: any) => m.user.id === dev.id).user.botVerified).toBeUndefined();
  });

  it('deleting a team leaves its applications with the team’s owner', async () => {
    if (!db) return;
    expect((await call(dev, 'DELETE', `/teams/${teamId}`)).statusCode).toBe(403);
    expect((await call(owner, 'DELETE', `/teams/${teamId}`)).statusCode).toBe(204);
    expect((await call(owner, 'GET', '/applications')).json().applications).toEqual([expect.objectContaining({ id: appId, teamId: null, role: 'owner' })]);
    expect((await call(dev, 'GET', '/applications')).json().applications).toEqual([]);
  });

  it('an announcement relay publishes to the relays that follow it, without pinging anyone there', async () => {
    if (!db) return;
    // The source beacon, with an announcement relay; the stranger is a member and can see it.
    const newsBeacon = (await call(owner, 'POST', '/beacons', { name: 'Orbital News', isDiscoverable: true })).json().beacon.id;
    const news = (await call(owner, 'POST', `/beacons/${newsBeacon}/relays`, { name: 'news', type: 'text', isAnnouncement: true })).json().relay;
    expect(news.isAnnouncement).toBe(true);
    await call(stranger, 'POST', `/beacons/${newsBeacon}/join`);
    await call(dev, 'POST', `/beacons/${newsBeacon}/join`);

    // The stranger's own beacon follows it from a text relay.
    const home = (await call(stranger, 'POST', '/beacons', { name: 'Fan Club' })).json().beacon.id;
    const feed = (await call(stranger, 'GET', `/beacons/${home}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    const general = (await call(owner, 'GET', `/beacons/${newsBeacon}/relays`)).json().relays.find((r: any) => r.type === 'text' && !r.isAnnouncement).id;
    expect((await call(stranger, 'POST', `/relays/${general}/followers`, { targetRelayId: feed })).json().code).toBe('NOT_ANNOUNCEMENT');
    expect((await call(dev, 'POST', `/relays/${news.id}/followers`, { targetRelayId: feed })).statusCode).toBe(404);
    const follow = await call(stranger, 'POST', `/relays/${news.id}/followers`, { targetRelayId: feed });
    expect(follow.statusCode).toBe(201);
    expect(follow.json().webhook).toMatchObject({ name: 'Orbital News #news', sourceRelayId: news.id });
    expect((await call(stranger, 'POST', `/relays/${news.id}/followers`, { targetRelayId: feed })).json().code).toBe('ALREADY_FOLLOWING');
    expect((await call(stranger, 'POST', `/webhooks/${follow.json().webhook.id}/reset-token`)).json().code).toBe('FOLLOWER_WEBHOOK');

    // The owner posts and publishes; a member cannot publish someone else's.
    const post = (await call(owner, 'POST', `/channels/relay/${news.id}/transmissions`, { content: `Launch day! <@${stranger.id}>` })).json().transmission;
    expect((await call(dev, 'POST', `/channels/relay/${news.id}/transmissions/${post.id}/publish`)).statusCode).toBe(403);
    const published = await call(owner, 'POST', `/channels/relay/${news.id}/transmissions/${post.id}/publish`);
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ delivered: 1, transmission: { publishedAt: expect.any(String) } });
    expect((await call(owner, 'POST', `/channels/relay/${news.id}/transmissions/${post.id}/publish`)).json().code).toBe('ALREADY_PUBLISHED');

    const copies = (await call(stranger, 'GET', `/channels/relay/${feed}/transmissions`)).json().transmissions;
    const copy = copies.find((t: any) => t.crosspost?.transmissionId === post.id);
    expect(copy).toMatchObject({
      content: `Launch day! <@${stranger.id}>`,
      crosspost: { beaconId: newsBeacon, beaconName: 'Orbital News', relayId: news.id, relayName: 'news' },
      mentions: [],
    });
    expect(copy.author.botKind).toBe('webhook');

    // Ordinary text relays do not publish.
    const plain = (await call(owner, 'POST', `/channels/relay/${general}/transmissions`, { content: 'not news' })).json().transmission;
    expect((await call(owner, 'POST', `/channels/relay/${general}/transmissions/${plain.id}/publish`)).json().code).toBe('NOT_ANNOUNCEMENT');
  });
});

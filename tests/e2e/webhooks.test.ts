import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, eq, or } from '@subspace/database';

/** Incoming webhooks: managed with Manage Webhooks, executed with the secret URL alone. */
describe('Webhooks', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: '853660476763668481', username: 'hook_owner' };
  const member = { id: '853660476763668482', username: 'hook_member' };
  const users = [owner, member];
  const auth = (u: typeof owner) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: typeof owner | null, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: u ? auth(u) : {}, payload: payload as any });
  let beaconId = '';
  let general = '';
  let other = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true });
    beaconId = (await call('POST', '/beacons', owner, { name: 'Hooks', isDiscoverable: true })).json().beacon.id;
    general = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays.find((r: any) => r.type === 'text').id;
    other = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'alerts', type: 'text' })).json().relay.id;
    await call('POST', `/beacons/${beaconId}/join`, member);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await app.close();
  });

  it('creates a webhook (Manage Webhooks only), posts with it, and stops when the token resets or it is deleted', async () => {
    if (!db) return;
    expect((await call('POST', `/relays/${general}/webhooks`, member, { name: 'Nope' })).json().code).toBe('MISSING_PERMISSIONS');
    const hook = (await call('POST', `/relays/${general}/webhooks`, owner, { name: 'Deploy Bot', avatarUrl: 'https://example.com/a.png' })).json().webhook;
    expect(hook.url).toBe(`/api/v1/webhooks/${hook.id}/${hook.token}`);
    // The token is never shown again.
    expect((await call('GET', `/relays/${general}/webhooks`, owner)).json().webhooks[0]).not.toHaveProperty('token');

    const exec = (token: string, body: object) => call('POST', `/webhooks/${hook.id}/${token}`, null, body);
    expect((await exec('wrong', { content: 'hi' })).json().code).toBe('UNKNOWN_WEBHOOK');
    expect((await exec(hook.token, {})).json().code).toBe('EMPTY_MESSAGE');
    const sent = (await exec(hook.token, {
      content: `Deployed v1.2 @everyone <@${member.id}>`,
      username: 'CI',
      embeds: [{ title: 'Build passed', description: 'All green', color: 0x3ddc84, fields: [{ name: 'Tests', value: '356', inline: true }], image: { url: 'https://example.com/chart.png' } }],
    })).json().transmission;
    expect(sent.author).toMatchObject({ displayName: 'CI', avatarUrl: 'https://example.com/a.png', botKind: 'webhook' });
    expect(sent.mentionEveryone).toBe(false);
    expect(sent.mentions).toEqual([member.id]);
    expect(sent.embeds[0]).toMatchObject({ type: 'rich', title: 'Build passed', color: '#3DDC84', fields: [{ name: 'Tests', value: '356', inline: true }] });
    expect(sent.embeds[0].image.proxyUrl).toMatch(/^\/api\/v1\/embed-proxy\?url=/);
    // Members see it in the relay.
    const listed = (await call('GET', `/channels/relay/${general}/transmissions`, member)).json().transmissions;
    expect(listed.some((t: any) => t.id === sent.id && t.webhookId === hook.id)).toBe(true);

    // Move it to another relay; reset the token; delete it.
    await call('PATCH', `/webhooks/${hook.id}`, owner, { relayId: other, name: 'Alerts' });
    const moved = (await exec(hook.token, { content: 'moved' })).json().transmission;
    expect(moved).toMatchObject({ channelId: other, author: { displayName: 'Alerts' } });
    const fresh = (await call('POST', `/webhooks/${hook.id}/reset-token`, owner)).json().webhook;
    expect((await exec(hook.token, { content: 'old' })).json().code).toBe('UNKNOWN_WEBHOOK');
    expect((await exec(fresh.token, { content: 'new' })).statusCode).toBe(200);
    await call('DELETE', `/webhooks/${hook.id}`, owner);
    expect((await exec(fresh.token, { content: 'gone' })).json().code).toBe('UNKNOWN_WEBHOOK');
  });

  it('webhook authors cannot sign in, and their limits hold', async () => {
    if (!db) return;
    const hook = (await call('POST', `/relays/${general}/webhooks`, owner, { name: 'Spam' })).json().webhook;
    const [author] = await db.select().from(transmitters).where(eq(transmitters.displayName, 'Spam')).limit(1);
    expect(author.botKind).toBe('webhook');
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.77.0.9', payload: { username: author.email, password: '!' } })).statusCode).toBe(401);
    const tooBig = await call('POST', `/webhooks/${hook.id}/${hook.token}`, null, { embeds: Array.from({ length: 2 }, () => ({ description: 'x'.repeat(4000) })) });
    expect(tooBig.json().code).toBe('EMBED_TOO_LARGE');
  });
});

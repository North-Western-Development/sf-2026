import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, beaconMembers, transmissions, eq, or, and } from '@subspace/database';
import { matchKeyword, ruleMatch } from '../../apps/api-service/src/lib/automod.js';
import { meetsVerification } from '@subspace/constants';

/** Engagement, Audit Log, AutoMod, Safety Setup (verification) and Security Actions. */
describe('Beacon moderation', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: 'fb000000-0000-4000-8000-000000000001', username: 'mod_owner' };
  const pilot = { id: 'fb000000-0000-4000-8000-000000000002', username: 'mod_pilot' };
  const late = { id: 'fb000000-0000-4000-8000-000000000003', username: 'mod_late' };
  const users = [owner, pilot, late];
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: { id: string; username: string }, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: { ...auth(u), ...headers }, payload: payload as any });
  const send = (u: typeof owner, content: string) => call('POST', `/channels/relay/${textId}/transmissions`, u, { content });

  let beaconId = '';
  let textId = '';
  let alertId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) {
      await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true, createdAt: new Date(Date.now() - 86_400_000) });
    }
    const b = await call('POST', '/beacons', owner, { name: 'Moderated Beacon', isDiscoverable: true });
    beaconId = b.json().beacon.id;
    const relays = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays;
    textId = relays.find((r: any) => r.type === 'text').id;
    alertId = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'mod-alerts', type: 'text' })).json().relay.id;
    await call('POST', `/beacons/${beaconId}/join`, pilot);
    await db.update(beaconMembers).set({ hasCompletedOnboarding: true }).where(eq(beaconMembers.beaconId, beaconId));
  });

  afterAll(async () => {
    if (db) await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await app.close();
  });

  it('starts a beacon with a system relay and setup tips, and welcomes joins there', async () => {
    if (!db) return;
    const [beacon] = await db.select().from(beacons).where(eq(beacons.id, beaconId));
    expect(beacon.systemChannelId).toBe(textId);
    const rows = await db.select().from(transmissions).where(eq(transmissions.relayId, textId));
    expect(rows.map((r: any) => r.type)).toEqual(expect.arrayContaining(['system_tips', 'system_join']));
    expect(rows.find((r: any) => r.type === 'system_join').transmitterId).toBe(pilot.id);
  });

  it('validates engagement settings', async () => {
    if (!db) return;
    expect((await call('PATCH', `/beacons/${beaconId}`, owner, { afkTimeout: 42 })).statusCode).toBe(400);
    expect((await call('PATCH', `/beacons/${beaconId}`, owner, { systemChannelId: alertId, defaultNotifications: 'mentions' })).statusCode).toBe(200);
    expect((await call('PATCH', `/beacons/${beaconId}`, owner, { afkChannelId: textId })).statusCode).toBe(400);
    expect((await call('PATCH', `/beacons/${beaconId}`, pilot, { welcomeMessages: false })).statusCode).toBe(403);
    await call('PATCH', `/beacons/${beaconId}`, owner, { systemChannelId: textId });
  });

  it('keeps an audit log with the reason header, readable only with View Audit Log', async () => {
    if (!db) return;
    await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'logged', type: 'text' }, { 'x-audit-log-reason': encodeURIComponent('for the test') });
    expect((await call('GET', `/beacons/${beaconId}/audit-log`, pilot)).statusCode).toBe(403);
    const entries = (await call('GET', `/beacons/${beaconId}/audit-log`, owner)).json().entries;
    const created = entries.find((e: any) => e.action === 'relay_create' && e.targetName === 'logged');
    expect(created.reason).toBe('for the test');
    expect(created.actor.id).toBe(owner.id);
    const keys = entries.filter((e: any) => e.action === 'beacon_update').flatMap((e: any) => e.changes.map((c: any) => c.key));
    expect(keys).toContain('defaultNotifications');
    const filtered = (await call('GET', `/beacons/${beaconId}/audit-log?action=relay_create`, owner)).json().entries;
    expect(filtered.every((e: any) => e.action === 'relay_create')).toBe(true);
  });

  it('AutoMod blocks keywords, alerts a relay, times out, and leaves managers alone', async () => {
    if (!db) return;
    expect((await call('POST', `/beacons/${beaconId}/automod/rules`, pilot, { name: 'x', trigger: 'keyword' })).statusCode).toBe(403);
    expect((await call('POST', `/beacons/${beaconId}/automod/rules`, owner, { name: 'bad', trigger: 'keyword', regexes: ['(unclosed'] })).statusCode).toBe(400);
    const rule = (
      await call('POST', `/beacons/${beaconId}/automod/rules`, owner, {
        name: 'No spoilers',
        trigger: 'keyword',
        keywords: ['spoil*', 'ending'],
        allowList: ['spoiler'],
        customMessage: 'No spoilers here!',
        alertChannelId: alertId,
        timeoutSeconds: 60,
      })
    ).json().rule;

    const blocked = await send(pilot, 'they spoiled the ending');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'AUTOMOD_BLOCKED', error: 'No spoilers here!' });
    const alert = (await db.select().from(transmissions).where(and(eq(transmissions.relayId, alertId), eq(transmissions.type, 'system_automod'))))[0];
    expect(JSON.parse(alert.content)).toMatchObject({ rule: 'No spoilers', matched: 'spoiled' });
    const [member] = await db.select().from(beaconMembers).where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, pilot.id)));
    expect(new Date(member.timeoutUntil).getTime()).toBeGreaterThan(Date.now());
    await db.update(beaconMembers).set({ timeoutUntil: null }).where(eq(beaconMembers.transmitterId, pilot.id));

    // Allowed words and unrelated text pass; the owner is never stopped.
    expect((await send(pilot, 'spoiler tags are fine')).statusCode).toBe(201);
    expect((await send(owner, 'the ending is great')).statusCode).toBe(201);
    // Edits are checked too.
    const ok = (await send(pilot, 'a clean line')).json().transmission;
    expect((await call('PATCH', `/transmissions/${ok.id}`, pilot, { content: 'the ending!' })).statusCode).toBe(403);

    // Disabled rules do nothing.
    await call('PATCH', `/beacons/${beaconId}/automod/rules/${rule.id}`, owner, { enabled: false });
    await db.update(beaconMembers).set({ timeoutUntil: null }).where(eq(beaconMembers.transmitterId, pilot.id));
    expect((await send(pilot, 'the ending')).statusCode).toBe(201);
    const log = (await call('GET', `/beacons/${beaconId}/audit-log?action=automod_block`, owner)).json().entries;
    expect(log.length).toBeGreaterThan(0);
  });

  it('matches keywords the way Discord does', () => {
    expect(matchKeyword('a cat sat', 'cat')).toBe('cat');
    expect(matchKeyword('concatenate', 'cat')).toBeNull();
    expect(matchKeyword('catalog', 'cat*')).toBe('catalog');
    expect(matchKeyword('bobcat', '*cat')).toBe('bobcat');
    expect(matchKeyword('concatenate', '*cat*')).toBe('concatenate');
    const base = { keywords: [], regexes: [], allowList: [], presets: [], mentionLimit: 3 };
    expect(ruleMatch({ ...base, trigger: 'mention_spam' }, 'hi', { mentionCount: 4, repeats: 0 })).toBe('4 mentions');
    expect(ruleMatch({ ...base, trigger: 'spam' }, 'buy', { mentionCount: 0, repeats: 2 })).toBe('repeated transmission');
    expect(ruleMatch({ ...base, trigger: 'preset', presets: ['profanity'] }, 'oh shit', { mentionCount: 0, repeats: 0 })).toBe('shit');
  });

  it('holds new members to the verification level until they meet it', async () => {
    if (!db) return;
    await call('PATCH', `/beacons/${beaconId}`, owner, { verificationLevel: 'high' });
    await call('POST', `/beacons/${beaconId}/join`, late);
    await db.update(beaconMembers).set({ hasCompletedOnboarding: true }).where(eq(beaconMembers.transmitterId, late.id));
    expect((await send(late, 'hello?')).statusCode).toBe(403);
    await db.update(beaconMembers).set({ joinedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(beaconMembers.transmitterId, late.id));
    expect((await send(late, 'hello!')).statusCode).toBe(201);
    await call('PATCH', `/beacons/${beaconId}`, owner, { verificationLevel: 'none' });

    const account = { isEmailVerified: true, createdAt: new Date(Date.now() - 86_400_000), is2faEnabled: false };
    const member = { joinedAt: new Date(Date.now() - 3600_000), hasClearance: false };
    expect(meetsVerification('high', account, member)).toBe(true);
    expect(meetsVerification('highest', account, member)).toBe(false);
    expect(meetsVerification('low', { ...account, isEmailVerified: false }, member)).toBe(false);
    expect(meetsVerification('highest', { ...account, isEmailVerified: false }, { ...member, hasClearance: true })).toBe(true);
  });

  it('Security Actions pause joining and DMs between non-affiliates', async () => {
    if (!db) return;
    expect((await call('PATCH', `/beacons/${beaconId}`, owner, { invitesPausedUntil: new Date(Date.now() + 3 * 86_400_000).toISOString() })).statusCode).toBe(400);
    await call('PATCH', `/beacons/${beaconId}`, owner, { invitesPausedUntil: new Date(Date.now() + 3600_000).toISOString(), dmsPausedUntil: new Date(Date.now() + 3600_000).toISOString() });
    const outsider = { id: 'fb000000-0000-4000-8000-000000000009', username: 'mod_out' };
    await db.delete(transmitters).where(eq(transmitters.id, outsider.id));
    await db.insert(transmitters).values({ id: outsider.id, username: outsider.username, email: 'mod_out@subspace.test', passwordHash: 'x', displayName: 'out' });
    expect((await call('POST', `/beacons/${beaconId}/join`, outsider)).json().code).toBe('INVITES_PAUSED');
    expect((await call('POST', '/links', pilot, { targetId: late.id })).statusCode).toBe(403);
    await call('PATCH', `/beacons/${beaconId}`, owner, { invitesPausedUntil: null, dmsPausedUntil: null });
    expect((await call('POST', '/links', pilot, { targetId: late.id })).statusCode).toBe(201);
    expect((await call('POST', `/beacons/${beaconId}/join`, outsider)).statusCode).toBe(201);
    await db.delete(transmitters).where(eq(transmitters.id, outsider.id));
  });
});


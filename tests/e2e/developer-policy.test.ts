import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { DEFAULT_DEVELOPER_POLICY } from '@subspace/constants';
import { transmitters, oauthApps, staffAuditLog, instanceSettings, resolveBotIntents, DEVELOPER_POLICY_KEY, eq, inArray } from '@subspace/database';

/** Command Console › Developers: who may create applications and use privileged intents. */
describe('Developer policy', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const root = { id: '801756946623497001', username: 'dp_root' };
  const admin = { id: '801756946623497002', username: 'dp_admin' };
  const unverified = { id: '801756946623497003', username: 'dp_new' };
  const emailOnly = { id: '801756946623497004', username: 'dp_email' };
  const phoneOnly = { id: '801756946623497005', username: 'dp_phone' };
  const ids = [root.id, admin.id, unverified.id, emailOnly.id, phoneOnly.id];
  const call = (u: { id: string; username: string }, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: { authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` }, payload: payload as any });
  const setPolicy = (patch: Partial<typeof DEFAULT_DEVELOPER_POLICY>) => call(root, 'PUT', '/console/developer-policy', { ...DEFAULT_DEVELOPER_POLICY, ...patch });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
    await db.delete(transmitters).where(inArray(transmitters.id, ids));
    const base = { passwordHash: 'x', isEmailVerified: false };
    await db.insert(transmitters).values([
      { ...base, id: root.id, username: root.username, email: 'dp_root@subspace.test', displayName: 'Root', staffRank: 3, isEmailVerified: true },
      { ...base, id: admin.id, username: admin.username, email: 'dp_admin@subspace.test', displayName: 'Admin', staffRank: 2, isEmailVerified: true },
      { ...base, id: unverified.id, username: unverified.username, email: 'dp_new@subspace.test', displayName: 'New' },
      { ...base, id: emailOnly.id, username: emailOnly.username, email: 'dp_email@subspace.test', displayName: 'Email', isEmailVerified: true },
      { ...base, id: phoneOnly.id, username: phoneOnly.username, email: 'dp_phone@subspace.test', displayName: 'Phone', phone: '+15550100197', phoneVerifiedAt: new Date() },
    ]);
  });

  afterAll(async () => {
    if (db) {
      // The policy is instance-wide: leave the defaults for every other test.
      await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
      await db.delete(staffAuditLog).where(inArray(staffAuditLog.actorId, ids));
      await db.delete(oauthApps).where(inArray(oauthApps.ownerId, ids));
      await db.delete(transmitters).where(inArray(transmitters.id, ids));
    }
    await app.close();
  });

  it('is open by default, and only staff who manage developers can change it', async () => {
    if (!db) return;
    const mine = (await call(unverified, 'GET', '/applications/policy')).json();
    expect(mine.createApps).toEqual({ allowed: true, missing: [] });
    expect(mine.verification).toEqual({ email: false, phone: false, staff: false, verified: false });
    expect(mine.intents.messageContent).toEqual({ allowed: true, audience: 'everyone' });
    expect((await call(unverified, 'POST', '/applications', { name: 'Open Door' })).statusCode).toBe(201);

    expect((await call(admin, 'GET', '/console/developer-policy')).json().code).toBe('INSUFFICIENT_STAFF_RANK');
    expect((await call(root, 'GET', '/console/developer-policy')).json().policy).toEqual(DEFAULT_DEVELOPER_POLICY);
    // "Verified" has to mean something.
    expect((await setPolicy({ verifiedBy: [] })).statusCode).toBe(400);
  });

  it('a verified email or phone can be required to create applications', async () => {
    if (!db) return;
    expect((await setPolicy({ createAppsRequires: ['email'] })).statusCode).toBe(200);
    const refused = await call(phoneOnly, 'POST', '/applications', { name: 'No Email' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'APP_CREATION_RESTRICTED', missing: ['a verified email'] });
    expect((await call(emailOnly, 'POST', '/applications', { name: 'Has Email' })).statusCode).toBe(201);

    await setPolicy({ createAppsRequires: ['email', 'phone'] });
    expect((await call(emailOnly, 'POST', '/applications', { name: 'Needs Both' })).json().missing).toEqual(['a verified phone number']);
  });

  it('only verified accounts, where verified means what the instance says', async () => {
    if (!db) return;
    await setPolicy({ createApps: 'verified', verifiedBy: ['phone', 'staff'] });
    // A verified email alone does not count here.
    expect((await call(emailOnly, 'POST', '/applications', { name: 'Email Only' })).json().missing).toEqual(['a verified phone number or verification by staff']);
    expect((await call(phoneOnly, 'POST', '/applications', { name: 'Phone Counts' })).statusCode).toBe(201);

    // Verified by hand in the console.
    await setPolicy({ createApps: 'verified', verifiedBy: ['staff'] });
    expect((await call(phoneOnly, 'POST', '/applications', { name: 'Not Anymore' })).statusCode).toBe(403);
    expect((await call(admin, 'PATCH', `/console/transmitters/${emailOnly.id}/verified`, { verified: true })).statusCode).toBe(403);
    expect((await call(root, 'PATCH', `/console/transmitters/${emailOnly.id}/verified`, { verified: true })).json().transmitter.handVerifiedAt).toBeTruthy();
    expect((await call(emailOnly, 'POST', '/applications', { name: 'Hand Verified' })).statusCode).toBe(201);
    expect((await call(emailOnly, 'GET', '/applications/policy')).json().verification).toEqual({ email: true, phone: false, staff: true, verified: true });

    const list = (await call(root, 'GET', `/console/transmitters?search=${emailOnly.username}`)).json().transmitters;
    expect(list[0]).toMatchObject({ isEmailVerified: true, handVerifiedAt: expect.any(String) });
    const log = (await call(root, 'GET', '/console/audit-log')).json().entries.map((e: any) => e.action);
    expect(log).toEqual(expect.arrayContaining(['developers.policy', 'transmitter.verify']));
  });

  it('privileged intents can be kept for verified developers, and tightening takes them away', async () => {
    if (!db) return;
    await setPolicy({});
    const appId = (await call(phoneOnly, 'POST', '/applications', { name: 'Intent Bot' })).json().application.id;
    const bot = (await call(phoneOnly, 'POST', `/applications/${appId}/bot`)).json().bot;
    expect(bot).toMatchObject({ messageContent: false, activityIntent: false });
    // Open: both intents can be turned on.
    expect((await call(phoneOnly, 'PATCH', `/applications/${appId}/bot`, { messageContent: true, activityIntent: true })).json().bot).toMatchObject({ messageContent: true, activityIntent: true });
    expect(await resolveBotIntents(db, bot.userId)).toEqual({ messageContent: true, activity: true });

    // Message Content for verified accounts only (verified by staff): the bot loses it, keeps Activity Status.
    await setPolicy({ verifiedBy: ['staff'], intents: { messageContent: 'verified', activity: 'everyone' } });
    expect(await resolveBotIntents(db, bot.userId)).toEqual({ messageContent: false, activity: true });
    const policy = (await call(phoneOnly, 'GET', '/applications/policy')).json();
    expect(policy.intents.messageContent).toEqual({ allowed: false, audience: 'verified' });
    // Turning it on again is refused; turning it off is always fine.
    await call(phoneOnly, 'PATCH', `/applications/${appId}/bot`, { messageContent: false });
    const refused = await call(phoneOnly, 'PATCH', `/applications/${appId}/bot`, { messageContent: true });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('INTENT_RESTRICTED');

    // Staff verify the developer: allowed again.
    await call(root, 'PATCH', `/console/transmitters/${phoneOnly.id}/verified`, { verified: true });
    expect((await call(phoneOnly, 'PATCH', `/applications/${appId}/bot`, { messageContent: true })).statusCode).toBe(200);
    expect(await resolveBotIntents(db, bot.userId)).toEqual({ messageContent: true, activity: true });
    await call(root, 'PATCH', `/console/transmitters/${phoneOnly.id}/verified`, { verified: false });
    expect(await resolveBotIntents(db, bot.userId)).toEqual({ messageContent: false, activity: true });
  });

  it('two applications with the same name can both have a bot', async () => {
    if (!db) return;
    await setPolicy({});
    // Bot accounts were named from the start of their id, which repeats for minutes.
    const a = (await call(emailOnly, 'POST', '/applications', { name: 'Twin' })).json().application.id;
    const b = (await call(phoneOnly, 'POST', '/applications', { name: 'Twin' })).json().application.id;
    expect((await call(emailOnly, 'POST', `/applications/${a}/bot`)).statusCode).toBe(201);
    expect((await call(phoneOnly, 'POST', `/applications/${b}/bot`)).statusCode).toBe(201);
  });
});

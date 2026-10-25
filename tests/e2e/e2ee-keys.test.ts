import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, pointToPointLinks, e2eeDevices, transmissions, affiliations, eq, or } from '@subspace/database';
import { generateDeviceKeys, publicBundle, startSession, encrypt, decrypt, decodeText, type SessionBundle } from '@subspace/e2ee';

/** The key server and the ciphertext-only rule for encrypted links. */
describe('E2EE: key server and encrypted links', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const alice = { id: 'e7000000-0000-4000-8000-000000000001', username: 'e2ee_alice' };
  const bob = { id: 'e7000000-0000-4000-8000-000000000002', username: 'e2ee_bob' };
  const eve = { id: 'e7000000-0000-4000-8000-000000000003', username: 'e2ee_eve' };
  const tok = (u: typeof alice) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const call = (method: string, url: string, u?: typeof alice, payload?: unknown) =>
    app.inject({ method: method as any, url, headers: u ? { authorization: `Bearer ${tok(u)}` } : {}, payload: payload as any });
  let linkId = '';
  const keys: Record<string, Awaited<ReturnType<typeof generateDeviceKeys>>> = {};
  const deviceIds: Record<string, string> = {};

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const ids = [alice.id, bob.id, eve.id];
    await db.delete(pointToPointLinks).where(or(...ids.map((id) => eq(pointToPointLinks.transmitter1Id, id))));
    await db.delete(e2eeDevices).where(or(...ids.map((id) => eq(e2eeDevices.transmitterId, id))));
    await db.delete(affiliations).where(or(...ids.map((id) => eq(affiliations.transmitterId, id))));
    for (const u of [alice, bob, eve]) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username });
    }
    const [link] = await db.insert(pointToPointLinks).values({ transmitter1Id: alice.id, transmitter2Id: bob.id }).returning();
    linkId = link.id;
    await db.insert(affiliations).values({ transmitterId: alice.id, targetId: bob.id, status: 'accepted' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('will not encrypt a link until both people have a device', async () => {
    if (!db) return;
    expect((await call('POST', `/api/v1/e2ee/links/${linkId}/enable`, alice)).json().code).toBe('NO_DEVICE');
    keys.alice = await generateDeviceKeys(3);
    const reg = await call('POST', '/api/v1/e2ee/devices', alice, { name: 'Alice laptop', ...(await publicBundle(keys.alice)) });
    expect(reg.statusCode).toBe(201);
    deviceIds.alice = reg.json().device.id;
    expect((await call('POST', `/api/v1/e2ee/links/${linkId}/enable`, alice)).json().code).toBe('RECIPIENT_NO_DEVICE');
    keys.bob = await generateDeviceKeys(3);
    deviceIds.bob = (await call('POST', '/api/v1/e2ee/devices', bob, await publicBundle(keys.bob))).json().device.id;
    expect((await call('POST', `/api/v1/e2ee/links/${linkId}/enable`, eve)).statusCode).toBe(404);
    const on = await call('POST', `/api/v1/e2ee/links/${linkId}/enable`, alice);
    expect(on.statusCode).toBe(200);
    expect(on.json().encryptedAt).toBeTruthy();
  });

  it('rejects malformed keys', async () => {
    if (!db) return;
    const res = await call('POST', '/api/v1/e2ee/devices', eve, { identityKey: 'short', signingKey: 'x', signedPreKey: {}, oneTimePreKeys: [] });
    expect(res.statusCode).toBe(400);
  });

  it('hands each one-time prekey out once, and only to people with a reason to talk', async () => {
    if (!db) return;
    expect((await call('POST', `/api/v1/e2ee/devices/${deviceIds.bob}/bundle`, eve)).statusCode).toBe(404);
    expect((await call('GET', `/api/v1/e2ee/users/${bob.id}/devices`, eve)).statusCode).toBe(404);
    const seen = new Set<number | null>();
    for (let i = 0; i < 4; i++) {
      const { bundle } = (await call('POST', `/api/v1/e2ee/devices/${deviceIds.bob}/bundle`, alice)).json();
      seen.add(bundle.oneTimePreKey?.id ?? null);
    }
    // Three one-time prekeys, then none left (the session still works without one).
    expect([...seen]).toEqual([1, 2, 3, null]);
    expect((await call('GET', `/api/v1/e2ee/devices/${deviceIds.bob}/prekeys`, bob)).json().remaining).toBe(0);
    expect((await call('GET', `/api/v1/e2ee/devices/${deviceIds.bob}/prekeys`, alice)).statusCode).toBe(404);
  });

  it('stores only ciphertext in an encrypted link, which the recipient can open', async () => {
    if (!db) return;
    const { bundle } = (await call('POST', `/api/v1/e2ee/devices/${deviceIds.bob}/bundle`, alice)).json() as { bundle: SessionBundle };
    const session = await startSession(keys.alice, bundle);
    const envelope = await encrypt(session, JSON.stringify({ text: 'meet at airlock 7' }));
    const encrypted = { v: 1, senderDevice: deviceIds.alice, envelopes: { [deviceIds.bob]: envelope } };

    expect((await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'plain' })).json().code).toBe('ENCRYPTION_REQUIRED');
    expect((await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'mixed', encrypted })).json().code).toBe('ENCRYPTION_REQUIRED');
    expect((await call('POST', `/api/v1/links/${bob.id}/transmissions`, alice, { content: 'legacy route' })).json().code).toBe('ENCRYPTION_REQUIRED');

    const sent = await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { encrypted });
    expect(sent.statusCode).toBe(201);
    const [row] = await db.select().from(transmissions).where(eq(transmissions.id, sent.json().transmission.id));
    expect(row.content).toBe('');
    expect(row.encryptedPayload).not.toContain('airlock');

    const history = (await call('GET', `/api/v1/channels/link/${linkId}/transmissions`, bob)).json().transmissions;
    const got = history.find((t: any) => t.id === row.id);
    const out = await decrypt(keys.bob, deviceIds.alice, [], got.encrypted.envelopes[deviceIds.bob]);
    expect(JSON.parse(decodeText(out.plaintext)).text).toBe('meet at airlock 7');
  });

  it('only accepts ciphertext where the link is encrypted', async () => {
    if (!db) return;
    const [plainLink] = await db.insert(pointToPointLinks).values({ transmitter1Id: alice.id, transmitter2Id: eve.id }).returning();
    await db.insert(affiliations).values({ transmitterId: alice.id, targetId: eve.id, status: 'accepted' });
    const res = await call('POST', `/api/v1/channels/link/${plainLink.id}/transmissions`, alice, { encrypted: { v: 1, senderDevice: deviceIds.alice, envelopes: {} } });
    expect(res.json().code).toBe('NOT_ENCRYPTED');
  });

  it('relays call-key envelopes only from your own device to someone you can reach', async () => {
    if (!db) return;
    const envelope = { v: 1, header: { dh: 'x', pn: 0, n: 0 }, ciphertext: 'abc' };
    const ok = await call('POST', '/api/v1/e2ee/signal', alice, { to: bob.id, fromDevice: deviceIds.alice, toDevice: deviceIds.bob, envelope });
    expect(ok.statusCode).toBe(202);
    expect((await call('POST', '/api/v1/e2ee/signal', alice, { to: bob.id, fromDevice: deviceIds.bob, toDevice: deviceIds.bob, envelope })).statusCode).toBe(404);
    const stranger = '00000000-0000-4000-8000-0000000000ee';
    expect((await call('POST', '/api/v1/e2ee/signal', alice, { to: stranger, fromDevice: deviceIds.alice, toDevice: deviceIds.bob, envelope })).statusCode).toBe(404);
  });
});

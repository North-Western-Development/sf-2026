import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, e2eeDevices, affiliations, subspaceMeshes, subspaceMeshMembers, eq, or } from '@subspace/database';
import { generateDeviceKeys, publicBundle, startSession, encrypt, decrypt, decodeText, frankingCommitment, randomKey, type SessionBundle } from '@subspace/e2ee';

/** End-to-end encrypted group DMs (meshes): ciphertext only, sealed for every member's device. */
describe('E2EE: encrypted meshes', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const ann = { id: '214194560175570945', username: 'mesh_ann' };
  const ben = { id: '214194560175570946', username: 'mesh_ben' };
  const cat = { id: '214194560175570947', username: 'mesh_cat' };
  const dan = { id: '214194560175570948', username: 'mesh_dan' };
  const people = [ann, ben, cat, dan];
  const tok = (u: typeof ann) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const call = (method: string, url: string, u?: typeof ann, payload?: unknown) =>
    app.inject({ method: method as any, url, headers: u ? { authorization: `Bearer ${tok(u)}` } : {}, payload: payload as any });
  const keys: Record<string, Awaited<ReturnType<typeof generateDeviceKeys>>> = {};
  const deviceIds: Record<string, string> = {};
  let meshId = '';
  const register = async (u: typeof ann) => {
    keys[u.username] = await generateDeviceKeys(3);
    deviceIds[u.username] = (await call('POST', '/api/v1/e2ee/devices', u, await publicBundle(keys[u.username]))).json().device.id;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const ids = people.map((p) => p.id);
    await db.delete(subspaceMeshes).where(or(...ids.map((id) => eq(subspaceMeshes.ownerId, id))));
    await db.delete(e2eeDevices).where(or(...ids.map((id) => eq(e2eeDevices.transmitterId, id))));
    await db.delete(affiliations).where(or(...ids.map((id) => eq(affiliations.transmitterId, id))));
    for (const u of people) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username });
    }
    for (const other of [ben, cat, dan]) await db.insert(affiliations).values({ transmitterId: ann.id, targetId: other.id, status: 'accepted' });
    const [mesh] = await db.insert(subspaceMeshes).values({ ownerId: ann.id, name: 'Crew' }).returning();
    meshId = mesh.id;
    await db.insert(subspaceMeshMembers).values([ann, ben, cat].map((u) => ({ meshId, transmitterId: u.id })));
  });

  afterAll(async () => {
    await app.close();
  });

  it('turns on only when every member has an encryption device, and only for members', async () => {
    if (!db) return;
    expect((await call('POST', `/api/v1/e2ee/meshes/${meshId}/enable`, ann)).json().code).toBe('NO_DEVICE');
    await register(ann);
    await register(ben);
    const missing = await call('POST', `/api/v1/e2ee/meshes/${meshId}/enable`, ann);
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({ code: 'RECIPIENT_NO_DEVICE', missing: [cat.id] });
    await register(cat);
    expect((await call('POST', `/api/v1/e2ee/meshes/${meshId}/enable`, dan)).statusCode).toBe(404);
    const on = await call('POST', `/api/v1/e2ee/meshes/${meshId}/enable`, ann);
    expect(on.statusCode).toBe(200);
    expect(on.json().encryptedAt).toBeTruthy();
    const listed = (await call('GET', '/api/v1/meshes', ben)).json().meshes.find((m: any) => m.id === meshId);
    expect(listed.encryptedAt).toBeTruthy();
    expect(listed.members.map((m: any) => m.id).sort()).toEqual([ann.id, ben.id, cat.id].sort());
  });

  it('refuses plaintext on every route, and stores ciphertext each member can open', async () => {
    if (!db) return;
    expect((await call('POST', `/api/v1/channels/mesh/${meshId}/transmissions`, ann, { content: 'in the clear' })).json().code).toBe('ENCRYPTION_REQUIRED');
    expect((await call('POST', `/api/v1/meshes/${meshId}/transmissions`, ann, { content: 'in the clear' })).json().code).toBe('ENCRYPTION_REQUIRED');

    // Ann seals the message once per member device, franked.
    const fk = randomKey();
    const envelopes: Record<string, unknown> = {};
    for (const u of [ben, cat]) {
      const { bundle } = (await call('POST', `/api/v1/e2ee/devices/${deviceIds[u.username]}/bundle`, ann)).json() as { bundle: SessionBundle };
      const session = await startSession(keys.mesh_ann, bundle);
      envelopes[deviceIds[u.username]] = await encrypt(session, JSON.stringify({ text: 'meet at dawn', fk }));
    }
    const sent = await call('POST', `/api/v1/channels/mesh/${meshId}/transmissions`, ann, { encrypted: { v: 1, senderDevice: deviceIds.mesh_ann, envelopes, commitment: await frankingCommitment(fk, 'meet at dawn') } });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().transmission.content).toBe('');

    const history = (await call('GET', `/api/v1/channels/mesh/${meshId}/transmissions?limit=5`, cat)).json().transmissions;
    const msg = history.find((t: any) => t.encrypted);
    expect(JSON.stringify(history)).not.toContain('meet at dawn');
    const opened = await decrypt(keys.mesh_cat, deviceIds.mesh_ann, [], msg.encrypted.envelopes[deviceIds.mesh_cat]);
    expect(JSON.parse(decodeText(opened.plaintext)).text).toBe('meet at dawn');
    expect(history.some((t: any) => t.type === 'system_encryption')).toBe(true);
  });

  it('only adds people who can hold keys, and member changes carry the member list', async () => {
    if (!db) return;
    expect((await call('POST', `/api/v1/meshes/${meshId}/members`, ann, { targetId: dan.id })).json().code).toBe('RECIPIENT_NO_DEVICE');
    await register(dan);
    expect((await call('POST', `/api/v1/meshes/${meshId}/members`, ann, { targetId: dan.id })).statusCode).toBe(201);
    const members = (await call('GET', '/api/v1/meshes', dan)).json().meshes.find((m: any) => m.id === meshId).members;
    expect(members).toHaveLength(4);
  });
});

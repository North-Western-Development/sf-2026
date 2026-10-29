import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { PERMISSIONS, STAFF_RANKS } from '@subspace/constants';
import { generateDeviceKeys, publicBundle, frankingCommitment, randomKey } from '@subspace/e2ee';
import { affiliations, beaconMembers, incidentReports, pointToPointLinks, staffAuditLog, staffRoles, transmissions, e2eeDevices, and, eq, inArray, or } from '@subspace/database';
import { person, caller, seedPeople, cleanupPeople, captureBus } from '../support/security.js';

/**
 * Security: reporting end-to-end encrypted transmissions (message franking), the context shared
 * with staff, reports only about what the reporter can see, and staff reading a reported beacon
 * without joining it.
 */
describe('Security: encrypted reports and staff review', () => {
  let app: FastifyInstance;
  let db: any;
  const alice = person('803756946623560001', 'ser_alice');
  const bob = person('803756946623560002', 'ser_bob');
  const eve = person('803756946623560003', 'ser_eve');
  const owner = person('803756946623560004', 'ser_owner');
  const member = person('803756946623560005', 'ser_member');
  const mod = person('803756946623560006', 'ser_mod', STAFF_RANKS.MODERATOR);
  const clerk = person('803756946623560007', 'ser_clerk');
  const people = [alice, bob, eve, owner, member, mod, clerk];
  const { call } = caller(() => app);

  let link = '';
  let otherLink = '';
  const devices: Record<string, string> = {};
  /** Sent in the encrypted link, oldest first: id, sender, text and franking key. */
  const sent: Array<{ id: string; from: typeof alice; text: string; fk: string }> = [];
  let legacyId = '';
  let beforeEncryptionId = '';
  let otherLinkMsg = '';
  let clerkRole = '';
  let beaconId = '';
  let general = '';
  let hidden = '';
  let publicPost = '';
  let hiddenPost = '';
  let otherBeaconRelay = '';

  async function franked(from: typeof alice, to: typeof alice, text: string, attachments: any[] = []) {
    const fk = randomKey();
    return { fk, payload: { v: 1, senderDevice: devices[from.id], envelopes: { [devices[to.id]]: { sealed: true } }, commitment: await frankingCommitment(fk, text, attachments) } };
  }
  async function send(from: typeof alice, to: typeof alice, text: string, conv = link) {
    const { fk, payload } = await franked(from, to, text);
    const res = await call(from, 'POST', `/channels/link/${conv}/transmissions`, { encrypted: payload });
    expect(res.statusCode, res.body).toBe(201);
    return { id: res.json().transmission.id as string, from, text, fk };
  }
  const reveal = (m: { id: string; text: string; fk: string }) => ({ id: m.id, text: m.text, fk: m.fk });
  const report = (u: typeof alice, body: Record<string, unknown>) => call(u, 'POST', '/reports', { targetType: 'transmission', reason: 'harassment', ...body });
  const reportsBy = async (u: typeof alice) => db.select().from(incidentReports).where(eq(incidentReports.reporterId, u.id));

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(staffRoles).where(eq(staffRoles.name, 'ser clerk'));
    clerkRole = (await db.insert(staffRoles).values({ name: 'ser clerk', position: 5, permissions: 0 }).returning())[0].id;
    await seedPeople(db, people, (p) => (p.id === clerk.id ? { staffRoleId: clerkRole } : {}));
    await db.delete(e2eeDevices).where(inArray(e2eeDevices.transmitterId, people.map((p) => p.id)));

    // Affiliates, so the direct links are allowed.
    await db.insert(affiliations).values([
      { transmitterId: alice.id, targetId: bob.id, status: 'accepted' },
      { transmitterId: alice.id, targetId: eve.id, status: 'accepted' },
    ]);
    // An encrypted direct link between Alice and Bob, with one plaintext transmission from before.
    link = (await call(alice, 'POST', '/links', { targetId: bob.id })).json().link.id;
    beforeEncryptionId = (await call(alice, 'POST', `/channels/link/${link}/transmissions`, { content: 'hi, before encryption' })).json().transmission.id;
    for (const p of [alice, bob, eve]) devices[p.id] = (await call(p, 'POST', '/e2ee/devices', await publicBundle(await generateDeviceKeys(2)))).json().device.id;
    expect((await call(alice, 'POST', `/e2ee/links/${link}/enable`)).statusCode).toBe(200);
    // One sent before franking existed (no commitment), then fourteen franked ones.
    legacyId = (
      await db
        .insert(transmissions)
        .values({ p2pLinkId: link, transmitterId: bob.id, content: '', encryptedPayload: JSON.stringify({ v: 1, senderDevice: devices[bob.id], envelopes: {} }) })
        .returning()
    )[0].id;
    for (let i = 0; i < 14; i++) sent.push(await send(i % 2 ? bob : alice, i % 2 ? alice : bob, `line ${i}`));

    // Another encrypted link (Alice and Eve), for cross-conversation attempts.
    otherLink = (await call(alice, 'POST', '/links', { targetId: eve.id })).json().link.id;
    expect((await call(alice, 'POST', `/e2ee/links/${otherLink}/enable`)).statusCode).toBe(200);
    otherLinkMsg = (await send(eve, alice, 'elsewhere', otherLink)).id;

    // A beacon with a hidden relay, and another beacon.
    beaconId = (await call(owner, 'POST', '/beacons', { name: 'Review Fort', isDiscoverable: true })).json().beacon.id;
    general = (await call(owner, 'GET', `/beacons/${beaconId}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    hidden = (await call(owner, 'POST', `/beacons/${beaconId}/relays`, { name: 'back-room', type: 'text' })).json().relay.id;
    const everyone = (await call(owner, 'GET', `/beacons/${beaconId}/clearances`)).json().clearances.find((c: any) => c.position === 0).id;
    await call(owner, 'PUT', `/beacons/${beaconId}/relays/${hidden}/overwrites/${everyone}`, { targetType: 'clearance', allow: '0', deny: PERMISSIONS.VIEW_RELAY.toString() });
    await call(member, 'POST', `/beacons/${beaconId}/join`);
    publicPost = (await call(owner, 'POST', `/channels/relay/${general}/transmissions`, { content: 'buy cheap stuff' })).json().transmission.id;
    hiddenPost = (await call(owner, 'POST', `/channels/relay/${hidden}/transmissions`, { content: 'owners only' })).json().transmission.id;
    const other = (await call(eve, 'POST', '/beacons', { name: 'Elsewhere' })).json().beacon.id;
    otherBeaconRelay = (await call(eve, 'GET', `/beacons/${other}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
  });

  afterAll(async () => {
    if (db) {
      const ids = people.map((p) => p.id);
      await db.delete(incidentReports).where(inArray(incidentReports.reporterId, ids));
      await db.delete(pointToPointLinks).where(or(inArray(pointToPointLinks.transmitter1Id, ids), inArray(pointToPointLinks.transmitter2Id, ids)));
      await db.delete(e2eeDevices).where(inArray(e2eeDevices.transmitterId, ids));
      await db.delete(affiliations).where(or(inArray(affiliations.transmitterId, ids), inArray(affiliations.targetId, ids)));
    }
    await cleanupPeople(db, people);
    if (db) await db.delete(staffRoles).where(eq(staffRoles.id, clerkRole));
    await app.close();
  });

  describe('franking', () => {
    it('every encrypted transmission must be franked, and malformed payloads are refused on send and edit', async () => {
      if (!db) return;
      const { payload } = await franked(alice, bob, 'x');
      const bad = [
        { ...payload, commitment: undefined },
        { ...payload, commitment: 'short' },
        { ...payload, commitment: `${'A'.repeat(42)}=` },
        { ...payload, envelopes: { 'not-a-device': {} } },
        { ...payload, envelopes: { [devices[bob.id]]: 'string' } },
        { ...payload, senderDevice: '0' },
      ];
      for (const encrypted of bad) {
        expect((await call(alice, 'POST', `/channels/link/${link}/transmissions`, { encrypted })).statusCode, JSON.stringify(encrypted)).toBe(400);
        expect((await call(alice, 'PATCH', `/transmissions/${sent[0].id}`, { encrypted })).statusCode, JSON.stringify(encrypted)).toBe(400);
      }
      // An unknown field: the edit route refuses it; sending drops it (Fastify strips unknown properties) and never stores it.
      expect((await call(alice, 'PATCH', `/transmissions/${sent[0].id}`, { encrypted: { ...payload, extra: 'smuggled' } })).statusCode).toBe(400);
      const [row] = await db.select().from(transmissions).where(eq(transmissions.id, sent[0].id));
      expect(JSON.parse(row.encryptedPayload).extra).toBeUndefined();
      const dropped = await call(alice, 'POST', `/channels/link/${link}/transmissions`, { encrypted: { ...payload, extra: 'smuggled' } });
      const [stored] = await db.select().from(transmissions).where(eq(transmissions.id, dropped.json().transmission.id));
      expect(stored.encryptedPayload).not.toContain('smuggled');
      // Not part of the conversation the later tests report from.
      await db.delete(transmissions).where(eq(transmissions.id, stored.id));
    });
  });

  describe('reporting an encrypted transmission', () => {
    it('needs the reveal of the reported transmission itself', async () => {
      if (!db) return;
      const target = sent[7];
      expect((await report(bob, { targetId: target.id })).json().code).toBe('REVEAL_REQUIRED');
      expect((await report(bob, { targetId: target.id, reveals: [reveal(sent[6])] })).json().code).toBe('REVEAL_REQUIRED');
      expect(await reportsBy(bob)).toEqual([]);
    });

    it('verifies a true reveal, and records it with five on each side as staff will see them', async () => {
      if (!db) return;
      const target = sent[7];
      const window = sent.slice(2, 13);
      const res = await report(bob, { targetId: target.id, reveals: window.map(reveal) });
      expect(res.statusCode, res.body).toBe(201);
      const ctx = res.json().report.telemetrySnapshot.encryptedContext;
      expect(ctx.map((i: any) => i.id)).toEqual(window.map((m) => m.id));
      expect(ctx.every((i: any) => i.status === 'verified')).toBe(true);
      expect(ctx.find((i: any) => i.target).text).toBe('line 7');
      expect(ctx.find((i: any) => i.id === sent[3].id)).toMatchObject({ text: 'line 3', authorId: bob.id, authorName: bob.username });
      // Staff who review reports can read it; nobody else can.
      expect((await call(mod, 'GET', '/console/reports')).body).toContain('line 7');
      for (const u of [alice, bob, clerk]) expect((await call(u, 'GET', '/console/reports')).statusCode, u.username).toBe(403);
    });

    it('refuses forged text, another key, a missing key and changed attachments, and files nothing', async () => {
      if (!db) return;
      const target = sent[8];
      const before = (await reportsBy(alice)).length;
      for (const forged of [
        { ...reveal(target), text: 'line 8, but worse' },
        { ...reveal(target), fk: sent[9].fk },
        { ...reveal(target), fk: randomKey() },
        { id: target.id, text: target.text },
        { ...reveal(target), attachments: [{ url: '/x', key: randomKey(), filename: 'x.png', mimeType: 'image/png', size: 1 }] },
      ]) {
        const res = await report(alice, { targetId: target.id, reveals: [forged] });
        expect(res.json().code, JSON.stringify(forged)).toBe('REVEAL_MISMATCH');
      }
      // A true target with one forged neighbour fails as a whole.
      expect((await report(alice, { targetId: target.id, reveals: [reveal(target), { ...reveal(sent[9]), text: 'I never said that' }] })).json().code).toBe('REVEAL_MISMATCH');
      expect((await reportsBy(alice)).length).toBe(before);
    });

    it('takes only the context the server chose: not further away, not another conversation, not twice', async () => {
      if (!db) return;
      const target = sent[8];
      expect((await report(alice, { targetId: target.id, reveals: [reveal(target), reveal(sent[2])] })).json().code).toBe('REVEAL_OUT_OF_CONTEXT');
      expect((await report(alice, { targetId: target.id, reveals: [reveal(target), { id: otherLinkMsg, text: 'elsewhere', fk: randomKey() }] })).json().code).toBe('REVEAL_OUT_OF_CONTEXT');
      expect((await report(alice, { targetId: target.id, reveals: [reveal(target), reveal(target)] })).json().code).toBe('DUPLICATE_REVEAL');
      // At most the target and five on each side.
      expect((await report(alice, { targetId: target.id, reveals: sent.slice(0, 12).map(reveal) })).statusCode).toBe(400);
      // Malformed reveals.
      for (const r of [{ id: target.id, text: 'x', fk: 'nope' }, { id: 'abc', text: 'x' }, { id: target.id, text: 'x'.repeat(9000) }, { id: target.id, text: 'x', attachments: [{ url: '/x' }] }]) {
        expect((await report(alice, { targetId: target.id, reveals: [r] })).statusCode, JSON.stringify(r).slice(0, 80)).toBe(400);
      }
    });

    it('marks transmissions sent before franking as not verifiable, and keeps plaintext from before encryption as stored', async () => {
      if (!db) return;
      // The legacy one and the plaintext one are just before the first franked transmissions.
      const target = sent[2];
      const res = await report(alice, { targetId: target.id, reveals: [reveal(target), { id: legacyId, text: 'whatever the reporter says' }] });
      expect(res.statusCode, res.body).toBe(201);
      const ctx = res.json().report.telemetrySnapshot.encryptedContext;
      expect(ctx.find((i: any) => i.id === legacyId)).toMatchObject({ status: 'unverified', text: 'whatever the reporter says' });
      expect(ctx.find((i: any) => i.id === beforeEncryptionId)).toMatchObject({ status: 'not-shared', plain: true, text: 'hi, before encryption' });
      expect(ctx.find((i: any) => i.id === sent[3].id)).toMatchObject({ status: 'not-shared' });
      expect(ctx.find((i: any) => i.id === sent[3].id).text).toBeUndefined();
      // Reporting the plaintext one with a reveal is refused: the server already has it.
      expect((await report(alice, { targetId: target.id, reveals: [reveal(target), { id: beforeEncryptionId, text: 'x', fk: randomKey() }] })).json().code).toBe('NOT_ENCRYPTED');
    });

    it('must be reported as it is now, after an edit', async () => {
      if (!db) return;
      const target = sent[10];
      const { fk, payload } = await franked(target.from, target.from === alice ? bob : alice, 'line 10 (edited)');
      expect((await call(target.from, 'PATCH', `/transmissions/${target.id}`, { encrypted: payload })).statusCode).toBe(200);
      const reporter = target.from === alice ? bob : alice;
      expect((await report(reporter, { targetId: target.id, reveals: [reveal(target)] })).json().code).toBe('REVEAL_MISMATCH');
      const res = await report(reporter, { targetId: target.id, reveals: [{ id: target.id, text: 'line 10 (edited)', fk }] });
      expect(res.statusCode).toBe(201);
      expect(res.json().report.telemetrySnapshot.encryptedContext.find((i: any) => i.target)).toMatchObject({ edited: true, status: 'verified' });
    });

    it('only people in the conversation can report it', async () => {
      if (!db) return;
      const target = sent[5];
      const res = await report(eve, { targetId: target.id, reveals: [reveal(target)] });
      expect(res.statusCode).toBe(404);
      // Same answer as an id that does not exist: nothing to learn.
      expect((await report(eve, { targetId: '803756946623569999', reveals: [reveal(target)] })).statusCode).toBe(404);
      expect(await reportsBy(eve)).toEqual([]);
    });
  });

  describe('reporting anything', () => {
    it('only what the reporter can see: not other DMs, hidden relays or other beacons they are not in', async () => {
      if (!db) return;
      for (const targetId of [beforeEncryptionId, hiddenPost, sent[1].id]) {
        expect((await report(member, { targetId })).statusCode, targetId).toBe(404);
      }
      expect(await reportsBy(member)).toEqual([]);
      const ok = await report(member, { targetId: publicPost });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().report.telemetrySnapshot).toMatchObject({ transmissionContent: 'buy cheap stuff', beaconId, relayId: general });
    });

    it('takes reveals only for an encrypted transmission, and validates every field', async () => {
      if (!db) return;
      expect((await report(member, { targetId: publicPost, reveals: [{ id: publicPost, text: 'x' }] })).json().code).toBe('NOT_ENCRYPTED');
      expect((await call(member, 'POST', '/reports', { targetType: 'beacon', targetId: beaconId, reason: 'spam', reveals: [] })).json().code).toBe('NOT_ENCRYPTED');
      for (const body of [
        { targetType: 'transmission', targetId: publicPost, reason: 'made_up' },
        { targetType: 'channel', targetId: publicPost, reason: 'spam' },
        { targetType: 'transmission', targetId: { $ne: null }, reason: 'spam' },
        { targetType: 'transmission', targetId: publicPost, reason: 'spam', description: 'x'.repeat(1001) },
      ]) {
        expect((await call(member, 'POST', '/reports', body)).statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      }
      expect((await call(member, 'POST', '/reports', { targetType: 'transmitter', targetId: '803756946623569999', reason: 'spam' })).statusCode).toBe(404);
      expect((await call(null, 'POST', '/reports', { targetType: 'transmission', targetId: publicPost, reason: 'spam' })).statusCode).toBe(401);
    });
  });

  it('history around a transmission never returns one from another conversation', async () => {
    if (!db) return;
    // Around one of its own: exactly the window, the anchor once (it was repeated when compared by millisecond timestamps).
    const own = (await call(alice, 'GET', `/channels/link/${link}/transmissions?around=${sent[7].id}&limit=10`)).json().transmissions.map((t: any) => t.id);
    expect(own).toEqual(sent.slice(2, 13).map((m) => m.id));
    for (const foreign of [hiddenPost, otherLinkMsg, publicPost]) {
      const res = await call(alice, 'GET', `/channels/link/${link}/transmissions?around=${foreign}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().transmissions.map((t: any) => t.id)).not.toContain(foreign);
      for (const q of ['before', 'after']) {
        expect((await call(alice, 'GET', `/channels/link/${link}/transmissions?${q}=${foreign}`)).json().transmissions.map((t: any) => t.id)).not.toContain(foreign);
      }
    }
  });

  describe('staff reading a reported beacon', () => {
    let beaconReport = '';
    let messageReport = '';
    let userReport = '';

    beforeAll(async () => {
      if (!db) return;
      beaconReport = (await call(member, 'POST', '/reports', { targetType: 'beacon', targetId: beaconId, reason: 'spam' })).json().report.id;
      messageReport = (await report(member, { targetId: publicPost })).json().report.id;
      userReport = (await call(member, 'POST', '/reports', { targetType: 'transmitter', targetId: owner.id, reason: 'spam' })).json().report.id;
    });

    it('only staff who review reports, only for an open report about a beacon', async () => {
      if (!db) return;
      for (const u of [member, owner, clerk]) expect((await call(u, 'GET', `/console/reports/${beaconReport}/beacon`)).statusCode, u.username).toBe(403);
      expect((await call(null, 'GET', `/console/reports/${beaconReport}/beacon`)).statusCode).toBe(401);
      expect((await call(mod, 'GET', `/console/reports/${userReport}/beacon`)).json().code).toBe('NO_BEACON');
      expect((await call(mod, 'GET', '/console/reports/803756946623569999/beacon')).statusCode).toBe(404);
      expect((await call(mod, 'GET', '/console/reports/abc/beacon')).statusCode).toBe(400);
      const ok = await call(mod, 'GET', `/console/reports/${messageReport}/beacon`);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().focus).toEqual({ relayId: general, transmissionId: publicPost });
      // Hidden relays too: staff are investigating the whole beacon.
      expect(ok.json().relays.map((r: any) => r.id)).toEqual(expect.arrayContaining([general, hidden]));
    });

    it('never joins: no membership, not in the member list, no events, and every relay opened is logged', async () => {
      if (!db) return;
      const events = await captureBus(async () => {
        await call(mod, 'GET', `/console/reports/${beaconReport}/beacon`);
        const read = await call(mod, 'GET', `/console/reports/${beaconReport}/beacon/relays/${hidden}/transmissions`);
        expect(read.statusCode).toBe(200);
        expect(read.json().transmissions.map((t: any) => t.content)).toContain('owners only');
        await call(mod, 'GET', `/console/reports/${messageReport}/beacon/relays/${general}/transmissions?around=${publicPost}`);
      });
      expect(JSON.stringify(events)).not.toContain(mod.id);
      expect(await db.select().from(beaconMembers).where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, mod.id)))).toEqual([]);
      expect((await call(owner, 'GET', `/beacons/${beaconId}/members`)).body).not.toContain(mod.id);
      const log = await db.select().from(staffAuditLog).where(eq(staffAuditLog.actorId, mod.id));
      expect(log.map((l: any) => l.action)).toEqual(expect.arrayContaining(['report.read_beacon', 'report.read_relay']));
      expect(log.find((l: any) => l.action === 'report.read_relay' && l.targetId === hidden)).toBeTruthy();
    });

    it('only relays of that beacon, and anchors only within the relay', async () => {
      if (!db) return;
      expect((await call(mod, 'GET', `/console/reports/${beaconReport}/beacon/relays/${otherBeaconRelay}/transmissions`)).statusCode).toBe(404);
      const around = await call(mod, 'GET', `/console/reports/${beaconReport}/beacon/relays/${general}/transmissions?around=${hiddenPost}`);
      expect(around.json().transmissions).toEqual([]);
      expect((await call(mod, 'GET', `/console/reports/${beaconReport}/beacon/relays/${general}/transmissions?limit=1000`)).statusCode).toBe(400);
      // Unknown parameters are dropped, never acted on.
      expect((await call(mod, 'GET', `/console/reports/${beaconReport}/beacon/relays/${otherBeaconRelay}/transmissions?relayId=${general}`)).statusCode).toBe(404);
    });

    it('is read-only: staff still cannot post in the beacon', async () => {
      if (!db) return;
      expect((await call(mod, 'POST', `/channels/relay/${general}/transmissions`, { content: 'staff here' })).statusCode).toBeGreaterThanOrEqual(403);
      expect(await db.select().from(transmissions).where(eq(transmissions.transmitterId, mod.id))).toEqual([]);
    });

    it('ends when the report is closed', async () => {
      if (!db) return;
      expect((await call(mod, 'PATCH', `/console/reports/${beaconReport}`, { status: 'resolved' })).statusCode).toBe(200);
      expect((await call(mod, 'GET', `/console/reports/${beaconReport}/beacon`)).json().code).toBe('REPORT_CLOSED');
      expect((await call(mod, 'GET', `/console/reports/${beaconReport}/beacon/relays/${general}/transmissions`)).json().code).toBe('REPORT_CLOSED');
    });
  });
});

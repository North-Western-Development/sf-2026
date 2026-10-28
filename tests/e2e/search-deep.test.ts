import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, affiliations, signalBlacklist, pointToPointLinks, eq, or } from '@subspace/database';

/** Deep Search: DM scope, filters, paging, and that nothing outside the caller's reach leaks. */
describe('Search: deep transmission search', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const alice = { id: '555932424049786881', username: 'search_alice' };
  const bob = { id: '555932424049786882', username: 'search_bob' };
  const eve = { id: '555932424049786883', username: 'search_eve' };
  const tok = (u: { id: string; username: string }) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const inject = (method: string, url: string, token?: string, payload?: unknown) =>
    app.inject({ method: method as any, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as any });
  const search = (u: typeof alice, qs: string) => inject('GET', `/api/v1/search/transmissions?${qs}`, tok(u));
  let beaconId = '';
  let relayId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const ids = [alice.id, bob.id, eve.id];
    await db.delete(beacons).where(eq(beacons.ownerId, alice.id));
    await db.delete(pointToPointLinks).where(or(...ids.map((id) => eq(pointToPointLinks.transmitter1Id, id))));
    await db.delete(affiliations).where(or(...ids.map((id) => eq(affiliations.transmitterId, id))));
    await db.delete(signalBlacklist).where(or(...ids.map((id) => eq(signalBlacklist.transmitterId, id))));
    for (const u of [alice, bob, eve]) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username });
    }
    beaconId = (await inject('POST', '/api/v1/beacons', tok(alice), { name: 'Search Deep', isDiscoverable: true })).json().beacon.id;
    await inject('POST', `/api/v1/beacons/${beaconId}/join`, tok(bob));
    await inject('POST', `/api/v1/beacons/${beaconId}/onboarding/complete`, tok(bob), { agreedToRules: true, selectedClearanceIds: [] });
    relayId = (await inject('GET', `/api/v1/beacons/${beaconId}/relays`, tok(alice))).json().relays.find((r: any) => r.type === 'text').id;
    const send = (u: typeof alice, content: string) => inject('POST', `/api/v1/channels/relay/${relayId}/transmissions`, tok(u), { content });
    await send(alice, 'pulsar alpha');
    await send(bob, `pulsar beta <@${alice.id}>`);
    await send(bob, 'pulsar gamma https://pulsar.example/map');
    await send(alice, '100% pulsar_core');
    // A DM between alice and bob (friends, so it is delivered directly).
    const req = await inject('POST', '/api/v1/affiliations/request', tok(alice), { targetId: bob.id });
    await inject('POST', `/api/v1/affiliations/${req.json().affiliation.id}/accept`, tok(bob));
    const dm = await inject('POST', `/api/v1/links/${alice.id}/transmissions`, tok(bob), { content: 'private pulsar coordinates' });
    expect(dm.statusCode, dm.body).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a term or a filter', async () => {
    if (!db) return;
    const res = await search(alice, `beaconId=${beaconId}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('SEARCH_EMPTY');
  });

  it('keeps beacon and DM results apart', async () => {
    if (!db) return;
    const beacon = (await search(alice, `q=pulsar&beaconId=${beaconId}`)).json();
    expect(beacon.total).toBe(4);
    expect(JSON.stringify(beacon)).not.toContain('private pulsar');
    expect(beacon.transmissions[0].channel).toMatchObject({ channelType: 'relay', channelId: relayId, beaconId, beaconName: 'Search Deep' });

    const dms = (await search(alice, 'q=pulsar&scope=dms')).json();
    expect(dms.total).toBe(1);
    expect(dms.transmissions[0].content).toBe('private pulsar coordinates');
    expect(dms.transmissions[0].channel).toMatchObject({ channelType: 'link', name: bob.username });
  });

  it('filters by author, mention, link, and pages in either order', async () => {
    if (!db) return;
    const fromBob = (await search(alice, `q=pulsar&beaconId=${beaconId}&from=${bob.id}`)).json();
    expect(fromBob.total).toBe(2);
    expect(fromBob.transmissions.every((t: any) => t.author.id === bob.id)).toBe(true);

    const mentions = (await search(alice, `beaconId=${beaconId}&mentions=${alice.id}`)).json();
    expect(mentions.transmissions.map((t: any) => t.content)).toEqual([`pulsar beta <@${alice.id}>`]);

    const links = (await search(alice, `beaconId=${beaconId}&has=link`)).json();
    expect(links.total).toBe(1);

    const oldest = (await search(alice, `q=pulsar&beaconId=${beaconId}&sort=oldest&limit=2`)).json();
    expect(oldest.transmissions.map((t: any) => t.content)).toEqual(['pulsar alpha', `pulsar beta <@${alice.id}>`]);
    const page2 = (await search(alice, `q=pulsar&beaconId=${beaconId}&sort=oldest&limit=2&offset=2`)).json();
    expect(page2.transmissions[0].content).toBe('pulsar gamma https://pulsar.example/map');
    expect(page2.total).toBe(4);
  });

  it('treats LIKE wildcards literally', async () => {
    if (!db) return;
    const pct = (await search(alice, `q=${encodeURIComponent('100%')}&beaconId=${beaconId}`)).json();
    expect(pct.transmissions.map((t: any) => t.content)).toEqual(['100% pulsar_core']);
    const underscore = (await search(alice, `q=${encodeURIComponent('r_c')}&beaconId=${beaconId}`)).json();
    expect(underscore.transmissions.map((t: any) => t.content)).toEqual(['100% pulsar_core']);
  });

  it('hides beacons and DMs the caller is not part of, and blocked authors', async () => {
    if (!db) return;
    expect((await search(eve, `q=pulsar&beaconId=${beaconId}`)).statusCode).toBe(403);
    expect((await search(eve, 'q=pulsar')).json().total).toBe(0);
    expect((await search(eve, 'q=pulsar&scope=dms')).json().total).toBe(0);

    await inject('POST', `/api/v1/blacklist`, tok(alice), { targetType: 'transmitter', targetId: bob.id });
    const blocked = await db.select().from(signalBlacklist).where(eq(signalBlacklist.transmitterId, alice.id));
    if (!blocked.length) await db.insert(signalBlacklist).values({ transmitterId: alice.id, targetType: 'transmitter', targetId: bob.id });
    const res = (await search(alice, `q=pulsar&beaconId=${beaconId}`)).json();
    expect(res.transmissions.every((t: any) => t.author.id !== bob.id)).toBe(true);
    expect(res.total).toBe(2);
  });

  it('rejects malformed filters instead of passing them to SQL', async () => {
    if (!db) return;
    for (const qs of ['q=x&from=not-a-uuid', 'q=x&has=everything', 'q=x&before=yesterday', 'q=x&offset=-1', 'q=x&sort=random']) {
      expect((await search(alice, qs)).statusCode, qs).toBe(400);
    }
  });
});

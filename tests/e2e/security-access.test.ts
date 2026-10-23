import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret, signRefreshToken, signTwoFactorChallengeToken } from '@subspace/crypto';
import { transmitters, eq } from '@subspace/database';

/**
 * Access-control sweep: every beacon/relay/channel-scoped endpoint must reject anonymous
 * callers (401) and outsiders (403/404), and privileged mutations must reject plain members.
 */
describe('Security: access control sweep', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  const owner = { id: 'a1000000-0000-4000-8000-000000000001', username: 'sec_owner' };
  const member = { id: 'a1000000-0000-4000-8000-000000000002', username: 'sec_member' };
  const outsider = { id: 'a1000000-0000-4000-8000-000000000003', username: 'sec_outsider' };
  const tok = (u: { id: string; username: string }) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  let beaconId = '';
  let relayId = '';
  let voiceId = '';
  let archivalId = '';
  let visualId = '';
  let transmissionId = '';

  const inject = (method: string, url: string, token?: string, payload?: unknown) =>
    app.inject({ method: method as any, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as any });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    const db = (app as any).db;
    for (const u of [owner, member, outsider]) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username });
    }
    const b = await inject('POST', '/api/v1/beacons', tok(owner), { name: 'Security Sweep', isDiscoverable: true });
    beaconId = b.json().beacon.id;
    await inject('POST', `/api/v1/beacons/${beaconId}/join`, tok(member));
    await inject('POST', `/api/v1/beacons/${beaconId}/onboarding/complete`, tok(member), { agreedToRules: true, selectedClearanceIds: [] });
    const relays = (await inject('GET', `/api/v1/beacons/${beaconId}/relays`, tok(owner))).json().relays;
    relayId = relays.find((r: any) => r.type === 'text').id;
    voiceId = relays.find((r: any) => r.type === 'comm_link').id;
    archivalId = (await inject('POST', `/api/v1/beacons/${beaconId}/relays`, tok(owner), { name: 'forum', type: 'archival' })).json().relay.id;
    visualId = (await inject('POST', `/api/v1/beacons/${beaconId}/relays`, tok(owner), { name: 'gallery', type: 'visual' })).json().relay.id;
    const t = await inject('POST', `/api/v1/channels/relay/${relayId}/transmissions`, tok(owner), { content: 'classified' });
    transmissionId = t.json().transmission.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const reads = () => [
    ['GET', `/api/v1/beacons/${beaconId}/members`],
    ['GET', `/api/v1/beacons/${beaconId}/relays`],
    ['GET', `/api/v1/beacons/${beaconId}/clearances`],
    ['GET', `/api/v1/beacons/${beaconId}/emojis`],
    ['GET', `/api/v1/beacons/${beaconId}/invites`],
    ['GET', `/api/v1/beacons/${beaconId}/bans`],
    ['GET', `/api/v1/beacons/${beaconId}/relays/${relayId}/overwrites`],
    ['GET', `/api/v1/relays/${relayId}/transmissions`],
    ['GET', `/api/v1/channels/relay/${relayId}/transmissions`],
    ['GET', `/api/v1/channels/relay/${relayId}/pins`],
    ['GET', `/api/v1/transmissions/${transmissionId}/reactions/${encodeURIComponent('👍')}`],
    ['GET', `/api/v1/relays/${archivalId}/archival/threads`],
    ['GET', `/api/v1/relays/${visualId}/visual/gallery`],
    ['GET', `/api/v1/relays/${voiceId}/comm-link/status`],
  ];

  it('rejects anonymous callers on every scoped read', async () => {
    const failures: string[] = [];
    for (const [m, url] of reads()) {
      const res = await inject(m, url);
      if (res.statusCode !== 401) failures.push(`${m} ${url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('rejects outsiders on every scoped read (no data leaks)', async () => {
    const failures: string[] = [];
    for (const [m, url] of reads()) {
      const res = await inject(m, url, tok(outsider));
      if (![403, 404].includes(res.statusCode)) failures.push(`${m} ${url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('rejects outsiders on scoped writes', async () => {
    const writes: Array<[string, string, unknown?]> = [
      ['POST', `/api/v1/channels/relay/${relayId}/transmissions`, { content: 'intrusion' }],
      ['POST', `/api/v1/relays/${relayId}/transmissions`, { content: 'intrusion' }],
      ['PUT', `/api/v1/transmissions/${transmissionId}/reactions/${encodeURIComponent('👍')}/@me`],
      ['PUT', `/api/v1/transmissions/${transmissionId}/pin`],
      ['PATCH', `/api/v1/transmissions/${transmissionId}`, { content: 'hijacked' }],
      ['DELETE', `/api/v1/transmissions/${transmissionId}`],
      ['POST', `/api/v1/channels/relay/${relayId}/typing`],
      ['POST', `/api/v1/channels/relay/${relayId}/ack`, { transmissionId }],
      ['POST', `/api/v1/relays/${voiceId}/comm-link/token`],
      ['POST', `/api/v1/beacons/${beaconId}/invites`, {}],
      ['PATCH', `/api/v1/beacons/${beaconId}`, { name: 'owned' }],
      ['POST', `/api/v1/beacons/${beaconId}/relays`, { name: 'x', type: 'text' }],
      ['POST', `/api/v1/beacons/${beaconId}/clearances`, { name: 'x' }],
    ];
    const failures: string[] = [];
    for (const [m, url, body] of writes) {
      const res = await inject(m, url, tok(outsider), body ?? {});
      if (![403, 404].includes(res.statusCode)) failures.push(`${m} ${url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('rejects privileged mutations from members without permission', async () => {
    const writes: Array<[string, string, unknown?]> = [
      ['PATCH', `/api/v1/beacons/${beaconId}`, { name: 'coup' }],
      ['DELETE', `/api/v1/beacons/${beaconId}`],
      ['POST', `/api/v1/beacons/${beaconId}/relays`, { name: 'rogue', type: 'text' }],
      ['DELETE', `/api/v1/beacons/${beaconId}/relays/${relayId}`],
      ['POST', `/api/v1/beacons/${beaconId}/clearances`, { name: 'admin', permissions: String(1n << 29n) }],
      ['PUT', `/api/v1/beacons/${beaconId}/relays/${relayId}/overwrites/${member.id}`, { targetType: 'transmitter', allow: String(1n << 29n), deny: '0' }],
      ['POST', `/api/v1/beacons/${beaconId}/members/${owner.id}/kick`],
      ['PUT', `/api/v1/beacons/${beaconId}/bans/${owner.id}`, {}],
      ['PATCH', `/api/v1/transmissions/${transmissionId}`, { content: 'not mine' }],
      ['DELETE', `/api/v1/transmissions/${transmissionId}`],
      ['PUT', `/api/v1/transmissions/${transmissionId}/pin`],
      ['POST', `/api/v1/beacons/${beaconId}/emojis`, { name: 'x', url: 'https://evil.example/x.png' }],
    ];
    const failures: string[] = [];
    for (const [m, url, body] of writes) {
      const res = await inject(m, url, tok(member), body ?? {});
      if (![400, 403, 404].includes(res.statusCode)) failures.push(`${m} ${url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('only accepts access tokens for API calls', async () => {
    const refresh = signRefreshToken(owner.id, SECRET);
    const challenge = signTwoFactorChallengeToken(owner.id, SECRET);
    for (const t of [refresh, challenge, 'not.a.jwt', '']) {
      const res = await inject('GET', '/api/v1/beacons/me', t || undefined);
      expect(res.statusCode).toBe(401);
    }
  });

  it('rejects arbitrary (non-uploaded) media URLs on profile and beacon fields', async () => {
    const bad = ['https://evil.example/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '/subspace-media/avatar/not-mine.png'];
    for (const url of bad) {
      expect((await inject('PATCH', '/api/v1/users/@me/profile', tok(member), { avatarUrl: url })).statusCode).toBe(400);
      expect((await inject('PATCH', `/api/v1/beacons/${beaconId}`, tok(owner), { iconUrl: url })).statusCode).toBe(400);
      expect((await inject('POST', '/api/v1/beacons', tok(owner), { name: 'x', iconUrl: url })).statusCode).toBe(400);
    }
  });

  it('does not let clients inject attachment URLs directly', async () => {
    const res = await inject('POST', `/api/v1/channels/relay/${relayId}/transmissions`, tok(member), {
      content: 'look',
      attachments: [{ id: 'x', url: 'https://evil.example/malware.exe', filename: 'totally-safe.pdf', size: 1 }],
    });
    // Either rejected by schema validation, or accepted with the unknown field dropped.
    if (res.statusCode === 201) expect(res.json().transmission.attachments).toEqual([]);
    else expect(res.statusCode).toBe(400);
  });

  it('stores message content verbatim (no server-side HTML) and enforces the length cap', async () => {
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const ok = await inject('POST', `/api/v1/channels/relay/${relayId}/transmissions`, tok(member), { content: xss });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().transmission.content).toBe(xss);
    const long = await inject('POST', `/api/v1/channels/relay/${relayId}/transmissions`, tok(member), { content: 'x'.repeat(2001) });
    expect(long.statusCode).toBe(400);
  });

  it('hides a private relay (VIEW denied to @everyone) from members on every read path', async () => {
    const created = await inject('POST', `/api/v1/beacons/${beaconId}/relays`, tok(owner), { name: 'command-deck', type: 'text' });
    const privateId = created.json().relay.id;
    const archival = await inject('POST', `/api/v1/beacons/${beaconId}/relays`, tok(owner), { name: 'sealed-archive', type: 'archival' });
    const privateForum = archival.json().relay.id;
    const everyone = (await inject('GET', `/api/v1/beacons/${beaconId}/clearances`, tok(owner))).json().clearances.find((c: any) => c.position === 0);
    for (const id of [privateId, privateForum]) {
      const ow = await inject('PUT', `/api/v1/beacons/${beaconId}/relays/${id}/overwrites/${everyone.id}`, tok(owner), { targetType: 'clearance', allow: '0', deny: '1' });
      expect(ow.statusCode).toBeLessThan(300);
    }
    await inject('POST', `/api/v1/channels/relay/${privateId}/transmissions`, tok(owner), { content: 'launch codes 0000' });

    const listed = (await inject('GET', `/api/v1/beacons/${beaconId}/relays`, tok(member))).json().relays.map((r: any) => r.id);
    expect(listed).not.toContain(privateId);

    const failures: string[] = [];
    for (const url of [
      `/api/v1/relays/${privateId}/transmissions`,
      `/api/v1/channels/relay/${privateId}/transmissions`,
      `/api/v1/channels/relay/${privateId}/pins`,
      `/api/v1/relays/${privateForum}/archival/threads`,
    ]) {
      const res = await inject('GET', url, tok(member));
      if (![403, 404].includes(res.statusCode)) failures.push(`GET ${url} -> ${res.statusCode}`);
    }
    const post = await inject('POST', `/api/v1/channels/relay/${privateId}/transmissions`, tok(member), { content: 'let me in' });
    if (![403, 404].includes(post.statusCode)) failures.push(`POST private relay -> ${post.statusCode}`);
    expect(failures).toEqual([]);

    const search = await inject('GET', `/api/v1/search/transmissions?q=launch`, tok(member));
    expect(JSON.stringify(search.json())).not.toContain('launch codes');
    const readStates = (await inject('GET', '/api/v1/read-states', tok(member))).json();
    expect(JSON.stringify(readStates)).not.toContain(privateId);

    // Owner still sees it.
    expect((await inject('GET', `/api/v1/channels/relay/${privateId}/transmissions`, tok(owner))).statusCode).toBe(200);
  });

  it('stops clearance managers from granting permissions they do not hold', async () => {
    const MANAGE_CLEARANCES = 1n << 10n;
    const ADMIN = 1n << 29n;
    const mgr = await inject('POST', `/api/v1/beacons/${beaconId}/clearances`, tok(owner), { name: 'role-manager', position: 5, permissions: String(MANAGE_CLEARANCES | 1n) });
    const mgrId = mgr.json().clearance.id;
    const assign = await inject('PATCH', `/api/v1/beacons/${beaconId}/members/${member.id}`, tok(owner), { clearanceIds: [mgrId] });
    expect(assign.statusCode).toBeLessThan(300);

    const escalate = await inject('POST', `/api/v1/beacons/${beaconId}/clearances`, tok(member), { name: 'backdoor', position: 1, permissions: String(ADMIN) });
    expect(escalate.statusCode).toBe(403);

    const clearances = (await inject('GET', `/api/v1/beacons/${beaconId}/clearances`, tok(owner))).json().clearances;
    const everyone = clearances.find((c: any) => c.position === 0);
    const widen = await inject('PATCH', `/api/v1/beacons/${beaconId}/clearances/${everyone.id}`, tok(member), { permissions: String(BigInt(everyone.permissions) | ADMIN) });
    expect(widen.statusCode).toBe(403);

    const malformed = await inject('POST', `/api/v1/beacons/${beaconId}/clearances`, tok(owner), { name: 'x', permissions: 'not-a-number' });
    expect(malformed.statusCode).toBe(400);

    // Toggling bits they do hold is still allowed.
    const ok = await inject('POST', `/api/v1/beacons/${beaconId}/clearances`, tok(member), { name: 'reader', position: 1, permissions: '1' });
    expect(ok.statusCode).toBe(201);
    await inject('PATCH', `/api/v1/beacons/${beaconId}/members/${member.id}`, tok(owner), { clearanceIds: [] });
  });

  it('never lets onboarding self-assign an elevated clearance', async () => {
    const mod = await inject('POST', `/api/v1/beacons/${beaconId}/clearances`, tok(owner), {
      name: 'moderator',
      position: 2,
      permissions: String((1n << 11n) | (1n << 8n)),
      allowDelegation: true,
    });
    const modId = mod.json().clearance.id;
    const cosmetic = await inject('POST', `/api/v1/beacons/${beaconId}/clearances`, tok(owner), { name: 'pilots', permissions: '0', allowDelegation: true });
    const cosmeticId = cosmetic.json().clearance.id;

    const listing = (await inject('GET', `/api/v1/beacons/${beaconId}/onboarding`, tok(member))).json();
    const offered = listing.optInClearances.map((c: any) => c.id);
    expect(offered).toContain(cosmeticId);
    expect(offered).not.toContain(modId);

    const res = await inject('POST', `/api/v1/beacons/${beaconId}/onboarding/complete`, tok(member), { agreedToRules: true, selectedClearanceIds: [modId, cosmeticId] });
    expect(res.statusCode).toBe(200);
    expect(res.json().member.clearanceIds).toContain(cosmeticId);
    expect(res.json().member.clearanceIds).not.toContain(modId);
  });

  it('keeps SQL metacharacters inert in search and names', async () => {
    const res = await inject('GET', `/api/v1/search/quick-scan?q=${encodeURIComponent("' OR 1=1 --")}`, tok(outsider));
    expect(res.statusCode).toBeLessThan(500);
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain('Security Sweep');
  });

  it('hides private beacons from non-members by id (404, same as missing)', async () => {
    const priv = (await inject('POST', '/api/v1/beacons', tok(owner), { name: 'Hidden Base', isDiscoverable: false })).json().beacon;
    expect((await inject('GET', `/api/v1/beacons/${priv.id}`, tok(outsider))).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/beacons/${priv.id}`)).statusCode).toBe(401);
    const mine = await inject('GET', `/api/v1/beacons/${priv.id}`, tok(owner));
    expect(mine.statusCode).toBe(200);
    expect(mine.json().beacon.name).toBe('Hidden Base');
    // Discoverable beacons stay previewable for any signed-in pilot.
    expect((await inject('GET', `/api/v1/beacons/${beaconId}`, tok(outsider))).statusCode).toBe(200);
  });

  it('opening a DM returns who it is with (not a bare row)', async () => {
    const res = await inject('POST', '/api/v1/links', tok(owner), { targetId: member.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().link.recipient).toMatchObject({ id: member.id, username: member.username });
    expect(res.json().link.recipient.passwordHash).toBeUndefined();
    expect(res.json().link.recipient.email).toBeUndefined();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, beacons, eq, or } from '@subspace/database';

/** Server mute, server deafen, move and disconnect in comm-links. */
describe('Voice moderation', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let redis: any;
  const owner = { id: '384196652961103873', username: 'vm_owner' };
  const mod = { id: '384196652961103874', username: 'vm_mod' };
  const loud = { id: '384196652961103875', username: 'vm_loud' };
  const users = [owner, mod, loud];
  const auth = (u: typeof owner) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: typeof owner, payload?: unknown) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  const inVoice = (u: typeof owner, relayId: string | null) => (relayId ? redis.hset('voice:relay', u.id, relayId) : redis.hdel('voice:relay', u.id));
  const moderate = (u: typeof owner, body: unknown) => call('PATCH', `/beacons/${beaconId}/voice-states/${loud.id}`, u, body);
  /** What their LiveKit token lets them do. */
  const grant = async (relayId: string) => {
    const res = (await call('POST', `/relays/${relayId}/comm-link/token`, loud)).json();
    const video = JSON.parse(Buffer.from(res.token.split('.')[1], 'base64url').toString()).video;
    return { canSpeak: res.canSpeak, sources: video.canPublishSources, canSubscribe: video.canSubscribe, data: video.canPublishData };
  };
  let beaconId = '';
  let lobby = '';
  let afk = '';
  let hidden = '';
  let roleId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    redis = (app as any).redis;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true, createdAt: new Date(Date.now() - 30 * 86_400_000) });
    beaconId = (await call('POST', '/beacons', owner, { name: 'Loud Room', isDiscoverable: true })).json().beacon.id;
    lobby = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays.find((r: any) => r.type === 'comm_link').id;
    afk = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'AFK', type: 'comm_link' })).json().relay.id;
    hidden = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'Staff Only', type: 'comm_link' })).json().relay.id;
    const everyone = (await call('GET', `/beacons/${beaconId}/clearances`, owner)).json().clearances.find((c: any) => c.position === 0);
    await call('PUT', `/beacons/${beaconId}/relays/${hidden}/overwrites/${everyone.id}`, owner, { targetType: 'clearance', allow: '0', deny: String(PERMISSIONS.VIEW_RELAY) });
    roleId = (await call('POST', `/beacons/${beaconId}/clearances`, owner, { name: 'Voice Mods', position: 1, permissions: String(PERMISSIONS.MUTE_MEMBERS | PERMISSIONS.DEAFEN_MEMBERS | PERMISSIONS.MOVE_MEMBERS) })).json().clearance.id;
    for (const u of [mod, loud]) await call('POST', `/beacons/${beaconId}/join`, u);
  });

  afterAll(async () => {
    if (db) {
      for (const u of users) await redis?.hdel('voice:relay', u.id);
      await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await app.close();
  });

  it('server-mutes and deafens a member until lifted, also on their next join', async () => {
    if (!db) return;
    expect(await grant(lobby)).toMatchObject({ canSpeak: true, sources: ['microphone'], canSubscribe: true, data: false });
    // Without Mute Members, no.
    expect((await moderate(mod, { mute: true })).json().code).toBe('MISSING_PERMISSIONS');
    await call('POST', `/beacons/${beaconId}/clearances/members/${mod.id}/assign`, owner, { clearanceId: roleId, action: 'add' });

    await inVoice(loud, lobby);
    expect((await moderate(mod, { mute: true })).json()).toMatchObject({ serverMuted: true, serverDeafened: false, relayId: lobby });
    expect(await grant(lobby)).toMatchObject({ canSpeak: false, sources: [], canSubscribe: true });
    const member = (await call('GET', `/beacons/${beaconId}/members`, owner)).json().members.find((m: any) => m.transmitterId === loud.id);
    expect(member).toMatchObject({ serverMuted: true, serverDeafened: false });

    expect((await moderate(mod, { deafen: true })).json()).toMatchObject({ serverMuted: true, serverDeafened: true });
    expect(await grant(afk)).toMatchObject({ canSpeak: false, canSubscribe: false });
    expect((await moderate(mod, { mute: false, deafen: false })).json()).toMatchObject({ serverMuted: false, serverDeafened: false });
    expect(await grant(lobby)).toMatchObject({ canSpeak: true, canSubscribe: true });

    // Nobody but the owner moderates the owner.
    expect((await call('PATCH', `/beacons/${beaconId}/voice-states/${owner.id}`, mod, { mute: true })).json().code).toBe('TARGET_IS_OWNER');
  });

  it('moves a connected member to a comm-link they can see, and disconnects them', async () => {
    if (!db) return;
    await inVoice(loud, null);
    expect((await moderate(mod, { relayId: afk })).json().code).toBe('NOT_IN_VOICE');
    await inVoice(loud, lobby);
    expect((await moderate(mod, { relayId: hidden })).json().code).toBe('DESTINATION_FORBIDDEN');
    const text = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays.find((r: any) => r.type === 'text').id;
    expect((await moderate(mod, { relayId: text })).json().code).toBe('INVALID_DESTINATION');
    expect((await moderate(mod, { relayId: afk })).json()).toMatchObject({ relayId: afk });
    await inVoice(loud, afk);
    expect((await moderate(mod, { relayId: null })).json()).toMatchObject({ relayId: null });
    await inVoice(loud, null);
  });
});

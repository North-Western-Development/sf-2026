import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, eq, newSnowflake } from '@subspace/database';

describe('Activity Privacy and Rich Presence images (API)', () => {
  let app: FastifyInstance;
  let token: string;
  const id = newSnowflake();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    await (app as any).db.insert(transmitters).values({ id, username: `player_${id.slice(-6)}`, email: `player_${id}@subspace.net`, passwordHash: 'x', displayName: 'Player' });
    token = signAccessToken({ transmitterId: id, username: 'player', staffRank: 0 }, getJwtSecret());
  });

  afterAll(async () => {
    await (app as any).db.delete(transmitters).where(eq(transmitters.id, id));
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('is off until turned on, and only takes off, everyone or friends', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth() });
    expect(me.json().transmitter?.activityVisibility ?? me.json().activityVisibility).toBe('off');

    const on = await app.inject({ method: 'PATCH', url: '/api/v1/users/@me/profile', headers: auth(), payload: { activityVisibility: 'friends' } });
    expect(on.statusCode).toBe(200);
    expect(on.json().transmitter.activityVisibility).toBe('friends');

    const bad = await app.inject({ method: 'PATCH', url: '/api/v1/users/@me/profile', headers: auth(), payload: { activityVisibility: 'strangers' } });
    expect(bad.statusCode).toBe(400);
  });

  it('never shows the setting to other people', async () => {
    const otherId = newSnowflake();
    const other = signAccessToken({ transmitterId: otherId, username: 'other', staffRank: 0 }, getJwtSecret());
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${id}/profile`, headers: { authorization: `Bearer ${other}` } });
    expect(JSON.stringify(res.json())).not.toContain('activityVisibility');
  });

  it('signs https image URLs for the media proxy, and nothing else', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/embed-proxy/sign',
      headers: auth(),
      payload: { urls: ['https://cdn.example.com/map.png', 'http://tracker.example/pixel.png', 'not a url'] },
    });
    expect(res.statusCode).toBe(200);
    const { proxied } = res.json();
    expect(Object.keys(proxied)).toEqual(['https://cdn.example.com/map.png']);
    expect(proxied['https://cdn.example.com/map.png']).toMatch(/^\/api\/v1\/embed-proxy\?url=https%3A%2F%2Fcdn\.example\.com%2Fmap\.png&sig=/);

    const anon = await app.inject({ method: 'POST', url: '/api/v1/embed-proxy/sign', payload: { urls: ['https://cdn.example.com/map.png'] } });
    expect(anon.statusCode).toBe(401);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, eq, or } from '@subspace/database';

/** OAuth2 apps: developer setup, consent, tokens with PKCE, the app API, and Authorized Apps. */
describe('OAuth2 apps and Authorized Apps', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const dev = { id: '371220770426060801', username: 'oauth_dev' };
  const user = { id: '371220770426060802', username: 'oauth_user' };
  const auth = (u: typeof dev) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u?: typeof dev, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: { ...(u ? auth(u) : {}), ...headers }, payload: payload as any });
  const form = (url: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, payload: new URLSearchParams(fields).toString() });
  const REDIRECT = 'http://localhost:9999/callback';
  let clientId = '';
  let clientSecret = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(transmitters).where(or(eq(transmitters.id, dev.id), eq(transmitters.id, user.id)));
    for (const u of [dev, user]) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true });
  });

  afterAll(async () => {
    if (db) await db.delete(transmitters).where(or(eq(transmitters.id, dev.id), eq(transmitters.id, user.id)));
    await app.close();
  });

  it('lets a developer create an app with registered redirect URIs and reset its secret', async () => {
    if (!db) return;
    expect((await call('POST', '/applications', dev, { name: 'Bad', redirectUris: ['http://evil.example/cb'] })).json().code).toBe('INVALID_REDIRECT_URI');
    const created = (await call('POST', '/applications', dev, { name: 'Star Tracker', description: 'Tracks stars', redirectUris: [REDIRECT] })).json();
    clientId = created.application.id;
    expect(created.clientSecret).toMatch(/^[\w-]{40,}$/);
    // Someone else cannot see or change it.
    expect((await call('GET', '/applications', user)).json().applications).toEqual([]);
    expect((await call('PATCH', `/applications/${clientId}`, user, { name: 'Mine now' })).statusCode).toBe(404);
    clientSecret = (await call('POST', `/applications/${clientId}/secret`, dev)).json().clientSecret;
    expect(clientSecret).not.toBe(created.clientSecret);
  });

  it('runs the authorization code flow with PKCE, serves the app API by scope, and rotates refresh tokens', async () => {
    if (!db) return;
    expect((await call('GET', `/oauth2/applications/${clientId}`, user)).json().application).toMatchObject({ name: 'Star Tracker', owner: 'oauth_dev' });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const base = { clientId, redirectUri: REDIRECT, scope: 'identify email', state: 'xyz', codeChallenge: challenge, codeChallengeMethod: 'S256' };
    expect((await call('POST', '/oauth2/authorize', user, { ...base, redirectUri: 'http://localhost:9999/other' })).json().code).toBe('INVALID_REDIRECT_URI');
    expect((await call('POST', '/oauth2/authorize', user, { ...base, scope: 'identify admin' })).json().code).toBe('INVALID_SCOPE');
    const location = new URL((await call('POST', '/oauth2/authorize', user, base)).json().location);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('xyz');
    const code = location.searchParams.get('code')!;

    expect((await form('/oauth2/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, client_secret: 'wrong', code_verifier: verifier })).json().error).toBe('invalid_client');
    expect((await form('/oauth2/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, client_secret: clientSecret, code_verifier: 'nope' })).json().error).toBe('invalid_grant');
    // A failed exchange spent the code; authorize again.
    const code2 = new URL((await call('POST', '/oauth2/authorize', user, base)).json().location).searchParams.get('code')!;
    const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const tokens = (await form('/oauth2/token', { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: verifier }, { authorization: basic })).json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'identify email' });
    expect((await form('/oauth2/token', { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: verifier }, { authorization: basic })).json().error).toBe('invalid_grant');

    const me = (await call('GET', '/oauth2/@me', undefined, undefined, { authorization: `Bearer ${tokens.access_token}` })).json();
    expect(me.user).toMatchObject({ id: user.id, username: 'oauth_user', email: 'oauth_user@subspace.test' });
    expect((await call('GET', '/oauth2/@me/beacons', undefined, undefined, { authorization: `Bearer ${tokens.access_token}` })).statusCode).toBe(403);
    // An app token is not a session: the rest of the API refuses it.
    expect((await call('GET', '/auth/me', undefined, undefined, { authorization: `Bearer ${tokens.access_token}` })).statusCode).toBe(401);

    const fresh = (await form('/oauth2/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, client_secret: clientSecret })).json();
    expect(fresh.access_token).toBeTruthy();
    expect((await form('/oauth2/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, client_secret: clientSecret })).json().error).toBe('invalid_grant');
    await form('/oauth2/token/revoke', { token: fresh.access_token, client_id: clientId, client_secret: clientSecret });
    expect((await call('GET', '/oauth2/@me', undefined, undefined, { authorization: `Bearer ${fresh.access_token}` })).statusCode).toBe(401);
  });

  it('lists the app under Authorized Apps, and deauthorizing cuts it off', async () => {
    if (!db) return;
    const code = new URL((await call('POST', '/oauth2/authorize', user, { clientId, redirectUri: REDIRECT, scope: 'identify beacons' })).json().location).searchParams.get('code')!;
    const tokens = (await form('/oauth2/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, client_secret: clientSecret })).json();
    expect((await call('GET', '/oauth2/@me/beacons', undefined, undefined, { authorization: `Bearer ${tokens.access_token}` })).json().beacons).toEqual([]);

    const grants = (await call('GET', '/users/@me/oauth2/grants', user)).json().grants;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ application: { name: 'Star Tracker', owner: 'oauth_dev' } });
    expect(grants[0].scopes.sort()).toEqual(['beacons', 'email', 'identify']);
    expect(grants[0].lastUsedAt).toBeTruthy();

    // Not someone else's to remove.
    await call('DELETE', `/users/@me/oauth2/grants/${grants[0].id}`, dev);
    expect((await call('GET', '/users/@me/oauth2/grants', user)).json().grants).toHaveLength(1);
    expect((await call('DELETE', `/users/@me/oauth2/grants/${grants[0].id}`, user)).statusCode).toBe(204);
    expect((await call('GET', '/oauth2/@me', undefined, undefined, { authorization: `Bearer ${tokens.access_token}` })).statusCode).toBe(401);
    expect((await form('/oauth2/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, client_secret: clientSecret })).json().error).toBe('invalid_grant');

    // Deleting the app removes everything.
    expect((await call('DELETE', `/applications/${clientId}`, dev)).statusCode).toBe(204);
    expect((await call('GET', `/oauth2/applications/${clientId}`, user)).statusCode).toBe(404);
  });
});

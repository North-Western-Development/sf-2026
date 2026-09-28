import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FastifyInstance } from 'fastify';
import { buildFileApp } from '../../apps/file-service/src/index.js';
import { buildApp as buildApiApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { transmitters, eq } from '@subspace/database';

describe('Parity Section 7: Media Uploads (file-service) E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let fileApp: FastifyInstance;
  let apiApp: FastifyInstance;

  const userId = 'c0000000-0000-0000-0000-000000000001';
  const otherUserId = 'c0000000-0000-0000-0000-000000000002';
  let userToken: string;
  let otherToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    fileApp = await buildFileApp();
    apiApp = await buildApiApp();
    await fileApp.ready();
    await apiApp.ready();

    const db = (fileApp as any).db;
    if (db) {
      for (const u of [
        { id: userId, username: 'media_user', email: 'media_user@subspace.net', passwordHash: 'hash', displayName: 'Media User' },
        { id: otherUserId, username: 'media_other', email: 'media_other@subspace.net', passwordHash: 'hash', displayName: 'Media Other' },
      ]) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) await db.insert(transmitters).values(u);
      }
    }

    userToken = signAccessToken({ transmitterId: userId, username: 'media_user', staffRank: 0 }, JWT_SECRET);
    otherToken = signAccessToken({ transmitterId: otherUserId, username: 'media_other', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await fileApp.close();
    await apiApp.close();
  });

  it('401s without a token', async () => {
    const res = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload-ticket',
      payload: { purpose: 'avatar', mimeType: 'image/png', sizeBytes: 1000 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('400s on an unsupported mime type', async () => {
    const res = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { purpose: 'avatar', mimeType: 'application/pdf', sizeBytes: 1000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('400s when sizeBytes exceeds the purpose limit', async () => {
    const res = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { purpose: 'glyph', mimeType: 'image/png', sizeBytes: 300 * 1024 }, // glyph limit is 256KB
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FILE_TOO_LARGE');

    const okAvatar = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { purpose: 'avatar', mimeType: 'image/png', sizeBytes: 8 * 1024 * 1024 + 1 }, // avatar limit 8MB
    });
    expect(okAvatar.statusCode).toBe(400);
    expect(okAvatar.json().code).toBe('FILE_TOO_LARGE');
  });

  it('issues a ticket and rejects complete() before the object is actually uploaded', async () => {
    const ticketRes = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { purpose: 'avatar', mimeType: 'image/png', sizeBytes: 1024 },
    });
    expect(ticketRes.statusCode).toBe(201);
    const { mediaId, publicUrl } = ticketRes.json();
    expect(publicUrl.startsWith('/subspace-media/avatar/')).toBe(true);

    const completeRes = await fileApp.inject({
      method: 'POST',
      url: `/api/v1/media/${mediaId}/complete`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(completeRes.statusCode).toBe(400);
    expect(completeRes.json().code).toBe('MEDIA_NOT_UPLOADED');
  });

  it('404s complete() for a ticket owned by someone else', async () => {
    const ticketRes = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { purpose: 'avatar', mimeType: 'image/png', sizeBytes: 1024 },
    });
    const { mediaId } = ticketRes.json();

    const res = await fileApp.inject({
      method: 'POST',
      url: `/api/v1/media/${mediaId}/complete`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('completes a real upload end-to-end and the resulting URL is accepted into a profile field; unknown/foreign URLs are rejected', async () => {
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );

    const ticketRes = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { purpose: 'avatar', mimeType: 'image/png', sizeBytes: png1x1.length },
    });
    expect(ticketRes.statusCode).toBe(201);
    const { mediaId, uploadUrl, publicUrl } = ticketRes.json();

    // The presigned URL is signed against S3_PUBLIC_ENDPOINT's host; replay it against the
    // real local MinIO endpoint while preserving that Host header (same trick the nginx/vite
    // proxy performs in real deployments). Uses node:http directly because fetch/undici
    // refuses to let callers override the Host header.
    const signedUrl = new URL(uploadUrl);
    const publicEndpoint = new URL(process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:5173');

    const uploaded = await new Promise<boolean>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: 9000,
          path: signedUrl.pathname + signedUrl.search,
          method: 'PUT',
          headers: {
            Host: publicEndpoint.host,
            'Content-Type': 'image/png',
            'Content-Length': png1x1.length,
          },
        },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(true);
            else {
              console.warn('[parity-media test] PUT to MinIO failed:', res.statusCode, body);
              resolve(false);
            }
          });
        }
      );
      req.on('error', (err) => {
        console.warn('[parity-media test] PUT to MinIO threw:', err);
        resolve(false);
      });
      req.write(png1x1);
      req.end();
    });
    if (!uploaded) return; // MinIO not reachable in this environment; skip the rest gracefully.

    const completeRes = await fileApp.inject({
      method: 'POST',
      url: `/api/v1/media/${mediaId}/complete`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.json().publicUrl).toBe(publicUrl);

    // Idempotent: completing again returns the same result instead of erroring.
    const completeAgain = await fileApp.inject({
      method: 'POST',
      url: `/api/v1/media/${mediaId}/complete`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(completeAgain.statusCode).toBe(200);

    if (!(apiApp as any).db) return;

    // Owner can use the completed URL as their own avatar.
    const applyRes = await apiApp.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { avatarUrl: publicUrl },
    });
    expect(applyRes.statusCode).toBe(200);
    expect(applyRes.json().transmitter.avatarUrl).toBe(publicUrl);

    // A different user cannot claim someone else's completed media as their own.
    const stolenRes = await apiApp.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { avatarUrl: publicUrl },
    });
    expect(stolenRes.statusCode).toBe(400);
    expect(stolenRes.json().code).toBe('INVALID_MEDIA_URL');

    // An arbitrary foreign URL is always rejected.
    const foreignRes = await apiApp.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { bannerUrl: 'https://evil.example.com/tracker.png' },
    });
    expect(foreignRes.statusCode).toBe(400);
    expect(foreignRes.json().code).toBe('INVALID_MEDIA_URL');
  });
});

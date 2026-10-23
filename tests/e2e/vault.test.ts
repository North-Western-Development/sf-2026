import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildFileApp } from '../../apps/file-service/src/index.js';
import { buildApp as buildApiApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { transmitters, vaultFiles, eq } from '@subspace/database';

describe('Subspace Vault (Storage) & Cloud Integrations E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let fileApp: FastifyInstance;
  let apiApp: FastifyInstance;

  const testUserId = '77777777-7777-7777-7777-777777777777';
  let userToken: string;
  let issuedStorageKey: string;
  let recordedFileId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    fileApp = await buildFileApp();
    apiApp = await buildApiApp();

    await fileApp.ready();
    await apiApp.ready();

    const db = (fileApp as any).db;
    if (db) {
      // Seed user with disclaimer NOT accepted initially
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, testUserId)).limit(1);
      if (existing.length === 0) {
        await db.insert(transmitters).values({
          id: testUserId,
          username: 'vault_explorer',
          email: 'explorer@subspace.vault',
          passwordHash: 'hash',
          displayName: 'Vault Explorer',
          hasAcceptedUploadDisclaimer: false,
        });
      } else {
        await db.update(transmitters).set({ hasAcceptedUploadDisclaimer: false }).where(eq(transmitters.id, testUserId));
      }
      await db.delete(vaultFiles).where(eq(vaultFiles.transmitterId, testUserId));
    }

    userToken = signAccessToken({ transmitterId: testUserId, username: 'vault_explorer', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await fileApp.close();
    await apiApp.close();
  });

  it('enforces mandatory upload disclaimer before issuing upload tickets', async () => {
    // 1. Attempt upload ticket before accepting disclaimer -> 403 DISCLAIMER_REQUIRED
    const res = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/vault/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        filename: 'star_chart.png',
        mimeType: 'image/png',
        sizeBytes: 1024 * 50,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('DISCLAIMER_REQUIRED');
    expect(body.disclaimerNotice).toBeDefined();

    // 2. Accept disclaimer
    const acceptRes = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/vault/disclaimer/accept',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(JSON.parse(acceptRes.payload).hasAcceptedUploadDisclaimer).toBe(true);

    // 3. Request upload ticket now -> succeeds with presigned S3 upload URL
    const ticketRes = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/vault/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        filename: 'star_chart.png',
        mimeType: 'image/png',
        sizeBytes: 1024 * 50,
      },
    });

    expect(ticketRes.statusCode).toBe(201);
    const ticketBody = JSON.parse(ticketRes.payload);
    expect(ticketBody.presignedUploadUrl).toBeDefined();
    expect(ticketBody.storageKey).toContain('vaults/');
    issuedStorageKey = ticketBody.storageKey;
  });

  it('rejects uploads exceeding maximum file size limit (50MB)', async () => {
    const hugeSize = 51 * 1024 * 1024; // 51MB
    const res = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/vault/upload-ticket',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        filename: 'massive_nebula.raw',
        mimeType: 'application/octet-stream',
        sizeBytes: hugeSize,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe('FILE_TOO_LARGE');
  });

  it('records uploaded file metadata, lists files with download URLs, and tracks quota', async () => {
    // Record file
    const recordRes = await fileApp.inject({
      method: 'POST',
      url: '/api/v1/vault/files',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        storageKey: issuedStorageKey,
        filename: 'star_chart.png',
        mimeType: 'image/png',
        sizeBytes: 1024 * 50,
      },
    });

    expect(recordRes.statusCode).toBe(201);
    const recordBody = JSON.parse(recordRes.payload);
    expect(recordBody.file.filename).toBe('star_chart.png');
    recordedFileId = recordBody.file.id;

    // List files
    const listRes = await fileApp.inject({
      method: 'GET',
      url: '/api/v1/vault/files',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.payload);
    expect(listBody.files.length).toBeGreaterThanOrEqual(1);
    expect(listBody.files[0].downloadUrl).toBeDefined();

    // Check quota
    const quotaRes = await fileApp.inject({
      method: 'GET',
      url: '/api/v1/vault/quota',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(quotaRes.statusCode).toBe(200);
    const quotaBody = JSON.parse(quotaRes.payload);
    expect(quotaBody.usedBytes).toBe(1024 * 50);
    expect(quotaBody.fileCount).toBeGreaterThanOrEqual(1);
    expect(quotaBody.hasAcceptedUploadDisclaimer).toBe(true);

    // Delete file
    const delRes = await fileApp.inject({
      method: 'DELETE',
      url: `/api/v1/vault/files/${recordedFileId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(delRes.statusCode).toBe(200);
  });

  it('returns active Cloud Drive tether configurations (Google Drive, OneDrive, Dropbox)', async () => {
    const res = await fileApp.inject({
      method: 'GET',
      url: '/api/v1/vault/integrations/config',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.integrations.google).toBeDefined();
    expect(body.integrations.google.name).toBe('Google Drive');
    expect(body.integrations.google.isEnabled).toBe(true);
    expect(body.integrations.google.clientId).toBe(
      '448110191150-r7racvvpsod6avnjfh6ubi123pco5omq.apps.googleusercontent.com'
    );

    expect(body.integrations.onedrive).toBeDefined();
    expect(body.integrations.onedrive.name).toBe('Microsoft OneDrive');
    expect(body.integrations.onedrive.isEnabled).toBe(true);
    expect(body.integrations.onedrive.clientId).toBe('deefc586-cdcb-427e-b6a5-60d139deaf4b');

    expect(body.integrations.dropbox).toBeDefined();
    expect(body.integrations.dropbox.name).toBe('Dropbox');
    expect(body.integrations.dropbox.isEnabled).toBe(true);
    expect(body.integrations.dropbox.clientId).toBe('1xxu145p7r3u75m');
  });

  it('enforces SSRF protection on Transmission URL Unfurler', async () => {
    // 1. Target loopback address -> blocked
    const loopbackRes = await apiApp.inject({
      method: 'POST',
      url: '/api/v1/unfurl',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { url: 'http://127.0.0.1:3001/api/v1/system/info' },
    });
    expect(loopbackRes.statusCode).toBe(400);
    expect(JSON.parse(loopbackRes.payload).code).toBe('INVALID_URL_TARGET');

    // 2. Target AWS / Cloud link-local metadata (169.254.169.254) -> blocked
    const metadataRes = await apiApp.inject({
      method: 'POST',
      url: '/api/v1/unfurl',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    expect(metadataRes.statusCode).toBe(400);
    expect(JSON.parse(metadataRes.payload).code).toBe('INVALID_URL_TARGET');

    // 3. Target localhost hostname -> blocked
    const localhostRes = await apiApp.inject({
      method: 'POST',
      url: '/api/v1/unfurl',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { url: 'http://localhost:9000/minio/health/live' },
    });
    expect(localhostRes.statusCode).toBe(400);
    expect(JSON.parse(localhostRes.payload).code).toBe('INVALID_URL_TARGET');

    // 4. Target private RFC 1918 (192.168.1.9) -> blocked
    const privateRes = await apiApp.inject({
      method: 'POST',
      url: '/api/v1/unfurl',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { url: 'http://192.168.1.9/status' },
    });
    expect(privateRes.statusCode).toBe(400);
    expect(JSON.parse(privateRes.payload).code).toBe('INVALID_URL_TARGET');
  });
});

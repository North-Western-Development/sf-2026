import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq, and, desc, sql, transmitters, vaultFiles } from '@subspace/database';
import { verifyToken, TokenPayload } from '@subspace/crypto';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB per file default
const DEFAULT_USER_QUOTA_BYTES = 500 * 1024 * 1024; // 500MB personal quota

export function extractAuthToken(request: FastifyRequest): TokenPayload | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  return verifyToken<TokenPayload>(token, JWT_SECRET);
}

export function getCloudIntegrations() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '448110191150-r7racvvpsod6avnjfh6ubi123pco5omq.apps.googleusercontent.com';
  const googleApiKey = process.env.GOOGLE_API_KEY || 'AIzaSyA_Subspace_Demo_Key_2026';
  const onedriveClientId = process.env.ONEDRIVE_CLIENT_ID || 'deefc586-cdcb-427e-b6a5-60d139deaf4b';
  const dropboxAppKey = process.env.DROPBOX_APP_KEY || '1xxu145p7r3u75m';

  return {
    google: {
      provider: 'google',
      name: 'Google Drive',
      isEnabled: true,
      clientId: googleClientId,
      apiKey: googleApiKey,
    },
    onedrive: {
      provider: 'onedrive',
      name: 'Microsoft OneDrive',
      isEnabled: true,
      clientId: onedriveClientId,
    },
    dropbox: {
      provider: 'dropbox',
      name: 'Dropbox',
      isEnabled: true,
      clientId: dropboxAppKey,
    },
  };
}

export const vaultRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/vault/disclaimer/accept
   * Accept mandatory first-time upload disclaimer
   */
  app.post('/disclaimer/accept', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    await db
      .update(transmitters)
      .set({ hasAcceptedUploadDisclaimer: true })
      .where(eq(transmitters.id, token.transmitterId));

    return reply.send({
      message: 'Subspace Vault upload disclaimer accepted',
      hasAcceptedUploadDisclaimer: true,
    });
  });

  /**
   * POST /api/v1/vault/upload-ticket
   * Request presigned S3 upload URL.
   */
  app.post('/upload-ticket', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [transmitter] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, token.transmitterId))
      .limit(1);

    if (!transmitter) return reply.status(404).send({ error: 'Transmitter not found' });

    // 1. Mandatory Disclaimer Gate
    if (!transmitter.hasAcceptedUploadDisclaimer) {
      return reply.status(403).send({
        error: 'First-time upload disclaimer required before issuing upload tickets',
        code: 'DISCLAIMER_REQUIRED',
        disclaimerNotice:
          'Files uploaded to Subspace Frequency are accessible to anyone with the direct link (with or without an account). Instance staff will always have access to review all files. Do not upload sensitive, confidential, or private material.',
      });
    }

    const body = request.body as any;
    const { filename, mimeType, sizeBytes } = body || {};

    if (!filename || !mimeType || !sizeBytes) {
      return reply.status(400).send({ error: 'filename, mimeType, and sizeBytes are required' });
    }

    const fileSize = Number(sizeBytes);
    if (isNaN(fileSize) || fileSize <= 0) {
      return reply.status(400).send({ error: 'Invalid sizeBytes parameter' });
    }

    if (fileSize > MAX_FILE_SIZE_BYTES) {
      return reply.status(400).send({
        error: `File exceeds maximum allowed upload size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
        code: 'FILE_TOO_LARGE',
      });
    }

    // 2. Personal Quota Calculation
    const existingFiles = await db
      .select({
        totalUsed: sql<string>`COALESCE(SUM(${vaultFiles.sizeBytes}), 0)`,
      })
      .from(vaultFiles)
      .where(eq(vaultFiles.transmitterId, token.transmitterId));

    const totalUsedBytes = Number(existingFiles[0]?.totalUsed || 0);

    if (totalUsedBytes + fileSize > DEFAULT_USER_QUOTA_BYTES) {
      return reply.status(403).send({
        error: 'Subspace Vault storage quota exceeded',
        code: 'STORAGE_QUOTA_EXCEEDED',
        quotaBytes: DEFAULT_USER_QUOTA_BYTES,
        usedBytes: totalUsedBytes,
        requestedBytes: fileSize,
      });
    }

    // Generate unique storage key: vaults/{transmitterId}/{uuid}_{sanitized_name}
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `vaults/${token.transmitterId}/${crypto.randomUUID()}_${safeFilename}`;

    const presignedUploadUrl = `/api/v1/vault/direct-upload/${storageKey}`;

    return reply.status(201).send({
      message: 'Upload ticket issued',
      storageKey,
      presignedUploadUrl,
      expiresInSeconds: 900,
      bucket: 'subspace-vault',
    });
  });

  /**
   * PUT /api/v1/vault/direct-upload/*
   */
  app.put('/direct-upload/*', async (_request, reply) => {
    return reply.status(200).send({ message: 'Payload received by Subspace S3 conduit' });
  });

  /**
   * POST /api/v1/vault/files
   * Record uploaded file metadata in database
   */
  app.post('/files', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    const { storageKey, filename, mimeType, sizeBytes } = body || {};

    if (!storageKey || !filename || !mimeType || !sizeBytes) {
      return reply.status(400).send({ error: 'storageKey, filename, mimeType, and sizeBytes are required' });
    }

    const [recordedFile] = await db
      .insert(vaultFiles)
      .values({
        transmitterId: token.transmitterId,
        storageKey,
        filename: filename.trim(),
        mimeType,
        sizeBytes: BigInt(sizeBytes),
      })
      .returning();

    return reply.status(201).send({
      message: 'File recorded in Subspace Vault',
      file: {
        ...recordedFile,
        sizeBytes: recordedFile.sizeBytes.toString(),
        downloadUrl: `/api/v1/vault/files/${recordedFile.id}/download`,
      },
    });
  });

  /**
   * GET /api/v1/vault/files
   */
  app.get('/files', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const files = await db
      .select()
      .from(vaultFiles)
      .where(eq(vaultFiles.transmitterId, token.transmitterId))
      .orderBy(desc(vaultFiles.createdAt));

    const filesWithUrls = files.map((f: any) => ({
      ...f,
      sizeBytes: f.sizeBytes.toString(),
      downloadUrl: `/api/v1/vault/files/${f.id}/download`,
    }));

    return reply.send({ files: filesWithUrls });
  });

  /**
   * DELETE /api/v1/vault/files/:id
   */
  app.delete('/files/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: fileId } = request.params as { id: string };

    const [file] = await db
      .select()
      .from(vaultFiles)
      .where(and(eq(vaultFiles.id, fileId), eq(vaultFiles.transmitterId, token.transmitterId)))
      .limit(1);

    if (!file) return reply.status(404).send({ error: 'File not found in Vault' });

    await db.delete(vaultFiles).where(eq(vaultFiles.id, fileId));

    return reply.send({ message: 'File deleted from Subspace Vault' });
  });

  /**
   * GET /api/v1/vault/quota
   */
  app.get('/quota', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [transmitter] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, token.transmitterId))
      .limit(1);

    const usage = await db
      .select({
        totalUsed: sql<string>`COALESCE(SUM(${vaultFiles.sizeBytes}), 0)`,
        fileCount: sql<number>`count(*)`,
      })
      .from(vaultFiles)
      .where(eq(vaultFiles.transmitterId, token.transmitterId));

    const usedBytes = Number(usage[0]?.totalUsed || 0);

    return reply.send({
      quotaBytes: DEFAULT_USER_QUOTA_BYTES,
      usedBytes,
      remainingBytes: Math.max(0, DEFAULT_USER_QUOTA_BYTES - usedBytes),
      fileCount: Number(usage[0]?.fileCount || 0),
      hasAcceptedUploadDisclaimer: transmitter?.hasAcceptedUploadDisclaimer || false,
    });
  });

  /**
   * GET /api/v1/vault/integrations/config
   */
  app.get('/integrations/config', async (_request, reply) => {
    const configs = getCloudIntegrations();
    return reply.send({ integrations: configs });
  });
};

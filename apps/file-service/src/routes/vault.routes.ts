import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq, and, desc, sql, transmitters, vaultFiles } from '@subspace/database';
import { verifyAccessToken, TokenPayload, getJwtSecret } from '@subspace/crypto';
import { SubspaceS3Storage } from '../s3.js';
import { getCloudIntegrations } from '../integrations/index.js';
import crypto from 'crypto';

const JWT_SECRET = getJwtSecret();
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB per file default
const DEFAULT_USER_QUOTA_BYTES = 500 * 1024 * 1024; // 500MB personal quota

export function extractAuthToken(request: FastifyRequest): TokenPayload | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  return verifyAccessToken(token, JWT_SECRET);
}

/** Types safe to render inline from our origin (no scriptable formats such as SVG/HTML). */
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
]);

export const vaultRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const s3: SubspaceS3Storage = (app as any).s3;

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
   * Invariants:
   * 1. Mandatory disclaimer gate: transmitter.hasAcceptedUploadDisclaimer must be true.
   * 2. Quota check: cannot exceed personal instance quota.
   * 3. Max file size: cannot exceed 50MB.
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

    const presignedUploadUrl = await s3.getPresignedUploadUrl(storageKey, mimeType, 900);

    return reply.status(201).send({
      message: 'Upload ticket issued',
      storageKey,
      presignedUploadUrl,
      expiresInSeconds: 900,
      bucket: s3.bucket,
    });
  });

  /**
   * POST /api/v1/vault/files
   * Record uploaded file metadata in database after direct S3 upload completes
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
      },
    });
  });

  /**
   * GET /api/v1/vault/files
   * List files belonging to the requesting transmitter
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

    const filesWithUrls = await Promise.all(
      files.map(async (f: any) => ({
        ...f,
        sizeBytes: f.sizeBytes.toString(),
        downloadUrl: await s3.getPresignedDownloadUrl(f.storageKey, 3600, undefined, {
          contentDisposition: `${INLINE_TYPES.has(String(f.mimeType).toLowerCase()) ? 'inline' : 'attachment'}; filename="${String(f.filename).replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'file'}"`,
          contentType: INLINE_TYPES.has(String(f.mimeType).toLowerCase()) ? f.mimeType : 'application/octet-stream',
        }),
      }))
    );

    return reply.send({ files: filesWithUrls });
  });

  /**
   * DELETE /api/v1/vault/files/:id
   * Delete file from Subspace Vault and S3 storage
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

    // Remove from S3
    try {
      await s3.deleteObject(file.storageKey);
    } catch (err: any) {
      console.warn('[Vault] Object delete warning:', err.message);
    }

    await db.delete(vaultFiles).where(eq(vaultFiles.id, fileId));

    return reply.send({ message: 'File deleted from Subspace Vault' });
  });

  /**
   * GET /api/v1/vault/quota
   * Get quota and storage utilization for transmitter
   */
  /**
   * GET /api/v1/vault/files/:id
   * Public attachment link (unguessable id; the upload disclaimer states links are public).
   * Redirects to a short-lived presigned URL. Only well-known media types render inline;
   * everything else is forced to download so uploaded HTML/SVG can never run in our origin.
   */
  app.get('/files/:id', { config: { public: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(404).send({ error: 'File not found' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const [file] = await db.select().from(vaultFiles).where(eq(vaultFiles.id, id)).limit(1);
    if (!file || file.isQuarantined) return reply.status(404).send({ error: 'File not found' });

    const inline = INLINE_TYPES.has(String(file.mimeType).toLowerCase());
    const safeName = String(file.filename).replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'file';
    const url = await s3.getPresignedDownloadUrl(file.storageKey, 300, undefined, {
      contentDisposition: `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
      contentType: inline ? file.mimeType : 'application/octet-stream',
    });
    reply.header('Cache-Control', 'private, max-age=240');
    return reply.redirect(url, 302);
  });

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
   * Returns active Cloud Drive tether configurations (Google Drive, OneDrive, Dropbox)
   */
  app.get('/integrations/config', async (request, reply) => {
    const configs = getCloudIntegrations();
    return reply.send({ integrations: configs });
  });
};

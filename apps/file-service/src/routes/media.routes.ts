import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq, and, mediaUploads } from '@subspace/database';
import { verifyAccessToken, TokenPayload, getJwtSecret } from '@subspace/crypto';
import {
  MEDIA_PURPOSES,
  MEDIA_MIME_EXTENSIONS,
  mediaMimesFor,
  type MediaPurpose,
} from '@subspace/constants';
import { SubspaceS3Storage } from '../s3.js';

const JWT_SECRET = getJwtSecret();
const MEDIA_PURPOSE_VALUES = Object.keys(MEDIA_PURPOSES) as MediaPurpose[];

export function extractAuthToken(request: FastifyRequest): TokenPayload | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyAccessToken(authHeader.split(' ')[1], JWT_SECRET);
}

export const mediaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const s3: SubspaceS3Storage = (app as any).s3;
  const mediaBucket: string = (app as any).mediaBucket;
  const mediaPublicBase: string = (app as any).mediaPublicBase || '/subspace-media';

  /**
   * POST /api/v1/media/upload-ticket
   */
  app.post(
    '/upload-ticket',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'mimeType', 'sizeBytes'],
          properties: {
            purpose: { type: 'string', enum: MEDIA_PURPOSE_VALUES },
            mimeType: { type: 'string' },
            sizeBytes: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { purpose, mimeType, sizeBytes } = request.body as {
        purpose: MediaPurpose;
        mimeType: string;
        sizeBytes: number;
      };

      const limit = MEDIA_PURPOSES[purpose];
      if (!limit) return reply.status(400).send({ error: 'Unknown media purpose' });
      if (!mediaMimesFor(purpose).includes(mimeType)) {
        return reply.status(400).send({ error: 'Unsupported media type', code: 'UNSUPPORTED_MEDIA_TYPE' });
      }
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > limit.maxBytes) {
        return reply.status(400).send({
          error: `File exceeds maximum allowed size of ${limit.maxBytes} bytes for purpose ${purpose}`,
          code: 'FILE_TOO_LARGE',
        });
      }

      const mediaId = randomUUID();
      const ext = MEDIA_MIME_EXTENSIONS[mimeType] || 'bin';
      const storageKey = `${purpose}/${mediaId}.${ext}`;
      const publicUrl = `${mediaPublicBase}/${storageKey}`;

      await db.insert(mediaUploads).values({
        id: mediaId,
        ownerId: token.transmitterId,
        purpose,
        mimeType,
        declaredSizeBytes: BigInt(Math.floor(sizeBytes)),
        storageKey,
        publicUrl,
        verified: false,
      });

      const expiresInSeconds = 900;
      const uploadUrl = await s3.getPresignedUploadUrl(storageKey, mimeType, expiresInSeconds, mediaBucket);

      return reply.status(201).send({
        uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        mediaId,
        publicUrl,
        expiresInSeconds,
      });
    }
  );

  /**
   * POST /api/v1/media/:mediaId/complete
   */
  app.post('/:mediaId/complete', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { mediaId } = request.params as { mediaId: string };
    const [media] = await db
      .select()
      .from(mediaUploads)
      .where(and(eq(mediaUploads.id, mediaId), eq(mediaUploads.ownerId, token.transmitterId)))
      .limit(1);

    if (!media) return reply.status(404).send({ error: 'Media ticket not found' });

    if (media.verified) {
      return reply.send({ publicUrl: media.publicUrl });
    }

    let head: { sizeBytes: number; contentType: string | undefined };
    try {
      head = await s3.headObject(media.storageKey, mediaBucket);
    } catch {
      return reply.status(400).send({
        error: 'Uploaded object not found; upload to the ticketed URL before completing',
        code: 'MEDIA_NOT_UPLOADED',
      });
    }

    if (head.sizeBytes <= 0 || head.sizeBytes > Number(media.declaredSizeBytes)) {
      return reply.status(400).send({ error: 'Uploaded object size mismatch', code: 'MEDIA_SIZE_MISMATCH' });
    }
    if (head.contentType && head.contentType !== media.mimeType) {
      return reply.status(400).send({ error: 'Uploaded object type mismatch', code: 'MEDIA_TYPE_MISMATCH' });
    }

    await db
      .update(mediaUploads)
      .set({ verified: true, completedAt: new Date() })
      .where(eq(mediaUploads.id, mediaId));

    return reply.send({ publicUrl: media.publicUrl });
  });
};

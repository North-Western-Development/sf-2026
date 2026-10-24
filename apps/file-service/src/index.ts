import { extractAuthToken } from './routes/vault.routes.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { TERMINOLOGY } from '@subspace/constants';

import helmet from '@fastify/helmet';
import { createDatabaseClient } from '@subspace/database';
import { requireSecret } from '@subspace/crypto';
import { SubspaceS3Storage } from './s3.js';
import { vaultRoutes } from './routes/vault.routes.js';
import { mediaRoutes } from './routes/media.routes.js';
import { driveRoutes } from './routes/drives.routes.js';

// Package-local .env first, then the repo-root .env (native runs); existing env always wins.
dotenv.config({ path: ['.env', '../../.env'] });

const port = Number(process.env.FILE_PORT) || 3003;
const host = process.env.FILE_HOST || '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || 'postgresql://subspace:subspace_secret@postgres:5432/subspace_frequency';

const s3Endpoint = process.env.S3_ENDPOINT || 'minio:9000';
const s3AccessKey = requireSecret('MINIO_ROOT_USER', 'minio_subspace');
const s3SecretKey = requireSecret('MINIO_ROOT_PASSWORD', 'minio_secret_subspace');
const s3Bucket = process.env.S3_BUCKET || 'subspace-vault';
const s3MediaBucket = process.env.S3_MEDIA_BUCKET || 'subspace-media';
const s3PublicEndpoint = process.env.S3_PUBLIC_ENDPOINT || undefined;
const mediaPublicBase = process.env.MEDIA_PUBLIC_BASE || '/subspace-media';

export async function buildFileApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // Every registered route, so the endpoint-coverage security test can sweep them all.
  const routeTable: Array<{ method: string; url: string }> = [];
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) if (method !== 'HEAD' && method !== 'OPTIONS') routeTable.push({ method, url: r.url });
  });
  app.decorate('routeTable', routeTable);

  // Secure by default: every route needs a valid access token before validation or the
  // handler runs. Routes that must work signed-out opt out with `config: { public: true }`.
  app.addHook('onRequest', async (request, reply) => {
    const config = request.routeOptions.config as { public?: boolean } | undefined;
    if (!request.routeOptions.url || config?.public) return;
    if (!extractAuthToken(request)) return reply.status(401).send({ error: 'Authentication required' });
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Database client
  let dbClient: ReturnType<typeof createDatabaseClient> | null = null;
  try {
    dbClient = createDatabaseClient(databaseUrl);
  } catch (err) {
    app.log.warn({ err }, '[File Service] PostgreSQL connection delayed during boot');
  }

  // MinIO S3 Storage
  const s3 = new SubspaceS3Storage({
    endpoint: s3Endpoint,
    accessKeyId: s3AccessKey,
    secretAccessKey: s3SecretKey,
    bucket: s3Bucket,
    publicEndpoint: s3PublicEndpoint,
  });

  // Provision buckets asynchronously: the private Vault bucket, and the anonymous
  // public-read `subspace-media` bucket for avatars/icons/glyphs (section 7).
  s3.ensureBucketExists().catch((err) => {
    app.log.warn({ err }, '[File Service] S3 bucket auto-provisioning warning');
  });
  s3.ensureBucketExists(s3MediaBucket)
    .then(() => s3.setPublicReadPolicy(s3MediaBucket))
    .catch((err) => {
      app.log.warn({ err }, '[File Service] Media bucket auto-provisioning warning');
    });

  (app as any).db = dbClient ? dbClient.db : null;
  (app as any).s3 = s3;
  (app as any).mediaBucket = s3MediaBucket;
  (app as any).mediaPublicBase = mediaPublicBase;

  // Register Vault routes
  await app.register(vaultRoutes, { prefix: '/api/v1/vault' });
  await app.register(driveRoutes, { prefix: '/api/v1/vault/drives' });

  // Register public-read media upload routes (section 7)
  await app.register(mediaRoutes, { prefix: '/api/v1/media' });

  app.get('/health', { config: { public: true } }, async () => {
    return {
      status: 'ok',
      service: 'file-service',
      component: TERMINOLOGY.FILE_DRIVE,
      s3Bucket,
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = await buildFileApp();
  try {
    await app.listen({ port, host });
    console.log(`[File Service] Subspace Vault listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

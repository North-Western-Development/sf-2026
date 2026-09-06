import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { TERMINOLOGY } from '@subspace/constants';

import helmet from '@fastify/helmet';
import { createDatabaseClient } from '@subspace/database';
import { SubspaceS3Storage } from './s3.js';
import { vaultRoutes } from './routes/vault.routes.js';

dotenv.config();

const port = Number(process.env.FILE_PORT) || 3003;
const host = process.env.FILE_HOST || '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || 'postgresql://subspace:subspace_secret@postgres:5432/subspace_frequency';

const s3Endpoint = process.env.S3_ENDPOINT || 'minio:9000';
const s3AccessKey = process.env.MINIO_ROOT_USER || 'minio_subspace';
const s3SecretKey = process.env.MINIO_ROOT_PASSWORD || 'minio_secret_subspace';
const s3Bucket = process.env.S3_BUCKET || 'subspace-vault';

export async function buildFileApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
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
  });

  // Provision bucket asynchronously
  s3.ensureBucketExists().catch((err) => {
    app.log.warn({ err }, '[File Service] S3 bucket auto-provisioning warning');
  });

  (app as any).db = dbClient ? dbClient.db : null;
  (app as any).s3 = s3;

  // Register Vault routes
  await app.register(vaultRoutes, { prefix: '/api/v1/vault' });

  app.get('/health', async () => {
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

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import dotenv from 'dotenv';
import { TERMINOLOGY } from '@subspace/constants';
import { createDatabaseClient } from '@subspace/database';
import { Redis } from 'ioredis';

dotenv.config();

const port = Number(process.env.API_PORT) || 3001;
const host = process.env.API_HOST || '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || 'postgresql://subspace:subspace_secret@postgres:5432/subspace_frequency';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

export async function buildApp() {
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

  // Database client initialization
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let dbClient: ReturnType<typeof createDatabaseClient> | null = null;
  let redisClient: Redis | null = null;

  try {
    dbClient = createDatabaseClient(databaseUrl);
    await dbClient.pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    app.log.warn({ err }, 'PostgreSQL connection delayed or unavailable during boot');
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redisClient.connect();
    redisStatus = 'connected';
  } catch (err) {
    app.log.warn({ err }, 'Redis connection delayed or unavailable during boot');
  }

  // Decorate app with db and redis clients
  (app as any).db = dbClient ? dbClient.db : null;
  (app as any).redis = redisClient;

  // Import and register auth routes
  const { authRoutes } = await import('./modules/auth/auth.routes.js');
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  // Health check endpoint
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'api-service',
      domain: 'Subspace Frequency',
      lexicon: {
        user: TERMINOLOGY.USER,
        message: TERMINOLOGY.MESSAGE,
        server: TERMINOLOGY.SERVER,
        channel: TERMINOLOGY.CHANNEL,
      },
      database: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  });

  // Diagnostics / System Information
  app.get('/api/v1/system/info', async () => {
    return {
      instance: 'Subspace Frequency Node',
      version: '0.1.0',
      terminology: TERMINOLOGY,
      status: 'operational',
    };
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = await buildApp();
  try {
    await app.listen({ port, host });
    console.log(`[API Service] Comm-Link listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

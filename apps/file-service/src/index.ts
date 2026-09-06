import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { TERMINOLOGY } from '@subspace/constants';

dotenv.config();

const port = Number(process.env.FILE_PORT) || 3003;
const host = process.env.FILE_HOST || '0.0.0.0';

export async function buildFileApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'file-service',
      component: TERMINOLOGY.FILE_DRIVE,
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

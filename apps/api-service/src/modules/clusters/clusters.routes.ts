import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, beaconClusters } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';

export const clusterRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/clusters
   * Get all beacon clusters (folders) for the requesting transmitter
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const userClusters = await db
      .select()
      .from(beaconClusters)
      .where(eq(beaconClusters.transmitterId, token.transmitterId));

    return reply.send({ clusters: userClusters });
  });

  /**
   * POST /api/v1/clusters
   * Create a beacon cluster folder
   */
  app.post('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    const { name, color, position, beaconIds } = body || {};

    if (!name || typeof name !== 'string') {
      return reply.status(400).send({ error: 'Cluster name is required' });
    }

    const [newCluster] = await db
      .insert(beaconClusters)
      .values({
        transmitterId: token.transmitterId,
        name: name.trim(),
        color: color || '#3B8EF2',
        position: Number(position) || 0,
        beaconIds: Array.isArray(beaconIds) ? beaconIds : [],
      })
      .returning();

    return reply.status(201).send({
      message: 'Beacon Cluster created',
      cluster: newCluster,
    });
  });

  /**
   * PATCH /api/v1/clusters/:id
   * Update cluster folder attributes or reorganize beacon IDs
   */
  app.patch('/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: clusterId } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(beaconClusters)
      .where(
        and(
          eq(beaconClusters.id, clusterId),
          eq(beaconClusters.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (!existing) {
      return reply.status(404).send({ error: 'Beacon cluster not found' });
    }

    const body = request.body as any;
    const updates: Record<string, any> = {};

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.color !== undefined) updates.color = body.color;
    if (body.position !== undefined) updates.position = Number(body.position);
    if (body.beaconIds !== undefined && Array.isArray(body.beaconIds)) updates.beaconIds = body.beaconIds;

    const [updated] = await db
      .update(beaconClusters)
      .set(updates)
      .where(eq(beaconClusters.id, clusterId))
      .returning();

    return reply.send({
      message: 'Beacon Cluster updated',
      cluster: updated,
    });
  });

  /**
   * DELETE /api/v1/clusters/:id
   * Delete cluster folder
   */
  app.delete('/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: clusterId } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(beaconClusters)
      .where(
        and(
          eq(beaconClusters.id, clusterId),
          eq(beaconClusters.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (!existing) {
      return reply.status(404).send({ error: 'Beacon cluster not found' });
    }

    await db.delete(beaconClusters).where(eq(beaconClusters.id, clusterId));

    return reply.send({ message: 'Beacon Cluster deleted' });
  });
};

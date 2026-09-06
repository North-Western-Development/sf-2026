import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  desc,
  subspaceMeshes,
  subspaceMeshMembers,
  transmissions,
  transmitters,
  signalBlacklist,
} from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';

const MAX_MESH_MEMBERS = 10;
const MAX_TRANSMISSION_LENGTH = 2000;

export const meshRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/meshes
   * Create a Subspace Mesh (Group DM, max 10 members)
   */
  app.post('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    const { name, iconUrl, memberIds } = body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.status(400).send({ error: 'Mesh name is required' });
    }

    const initialMembers = Array.isArray(memberIds) ? memberIds : [];
    const uniqueMembers = Array.from(new Set([token.transmitterId, ...initialMembers]));

    if (uniqueMembers.length > MAX_MESH_MEMBERS) {
      return reply.status(400).send({
        error: `Subspace Meshes support a maximum of ${MAX_MESH_MEMBERS} members`,
        code: 'MESH_CAPACITY_EXCEEDED',
      });
    }

    const [newMesh] = await db
      .insert(subspaceMeshes)
      .values({
        ownerId: token.transmitterId,
        name: name.trim(),
        iconUrl: iconUrl || null,
      })
      .returning();

    for (const memId of uniqueMembers) {
      await db.insert(subspaceMeshMembers).values({
        meshId: newMesh.id,
        transmitterId: memId,
      });
    }

    return reply.status(201).send({
      message: 'Subspace Mesh initialized',
      mesh: newMesh,
      memberCount: uniqueMembers.length,
    });
  });

  /**
   * GET /api/v1/meshes
   * List all meshes caller belongs to
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const userMeshes = await db
      .select({
        id: subspaceMeshes.id,
        name: subspaceMeshes.name,
        iconUrl: subspaceMeshes.iconUrl,
        ownerId: subspaceMeshes.ownerId,
        createdAt: subspaceMeshes.createdAt,
      })
      .from(subspaceMeshMembers)
      .innerJoin(subspaceMeshes, eq(subspaceMeshMembers.meshId, subspaceMeshes.id))
      .where(eq(subspaceMeshMembers.transmitterId, token.transmitterId));

    return reply.send({ meshes: userMeshes });
  });

  /**
   * POST /api/v1/meshes/:meshId/members
   * Add member to Mesh (capped at 10)
   */
  app.post('/:meshId/members', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { meshId } = request.params as { meshId: string };
    const body = request.body as any;
    const { targetId } = body || {};

    if (!targetId) return reply.status(400).send({ error: 'targetId required' });

    // Verify caller is member
    const [callerMember] = await db
      .select()
      .from(subspaceMeshMembers)
      .where(
        and(
          eq(subspaceMeshMembers.meshId, meshId),
          eq(subspaceMeshMembers.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (!callerMember) return reply.status(403).send({ error: 'Not a member of this Subspace Mesh' });

    // Check count
    const existingMembers = await db
      .select()
      .from(subspaceMeshMembers)
      .where(eq(subspaceMeshMembers.meshId, meshId));

    if (existingMembers.length >= MAX_MESH_MEMBERS) {
      return reply.status(400).send({
        error: `Subspace Mesh has reached maximum capacity of ${MAX_MESH_MEMBERS} members`,
        code: 'MESH_CAPACITY_EXCEEDED',
      });
    }

    await db.insert(subspaceMeshMembers).values({
      meshId,
      transmitterId: targetId,
    });

    return reply.status(201).send({
      message: 'Transmitter affiliated with Subspace Mesh',
      memberCount: existingMembers.length + 1,
    });
  });

  /**
   * POST /api/v1/meshes/:meshId/transmissions
   * Transmit to Subspace Mesh
   */
  app.post('/:meshId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { meshId } = request.params as { meshId: string };

    const [isMember] = await db
      .select()
      .from(subspaceMeshMembers)
      .where(
        and(
          eq(subspaceMeshMembers.meshId, meshId),
          eq(subspaceMeshMembers.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (!isMember) return reply.status(403).send({ error: 'Not a member of this Subspace Mesh' });

    const body = request.body as any;
    const { content } = body || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Content cannot be empty' });
    }

    if (content.length > MAX_TRANSMISSION_LENGTH) {
      return reply.status(400).send({
        error: `Transmission exceeds maximum allowed length of ${MAX_TRANSMISSION_LENGTH} characters`,
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
      });
    }

    const [newMsg] = await db
      .insert(transmissions)
      .values({
        meshId,
        transmitterId: token.transmitterId,
        content: content.trim(),
      })
      .returning();

    return reply.status(201).send({
      message: 'Mesh transmission dispatched',
      transmission: newMsg,
    });
  });

  /**
   * GET /api/v1/meshes/:meshId/transmissions
   * Fetch Mesh transmissions
   */
  app.get('/:meshId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { meshId } = request.params as { meshId: string };

    const [isMember] = await db
      .select()
      .from(subspaceMeshMembers)
      .where(
        and(
          eq(subspaceMeshMembers.meshId, meshId),
          eq(subspaceMeshMembers.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (!isMember) return reply.status(403).send({ error: 'Not a member of this Subspace Mesh' });

    const messages = await db
      .select({
        id: transmissions.id,
        meshId: transmissions.meshId,
        transmitterId: transmissions.transmitterId,
        content: transmissions.content,
        attachments: transmissions.attachments,
        isEdited: transmissions.isEdited,
        createdAt: transmissions.createdAt,
        authorName: transmitters.displayName,
        authorUsername: transmitters.username,
      })
      .from(transmissions)
      .innerJoin(transmitters, eq(transmissions.transmitterId, transmitters.id))
      .where(eq(transmissions.meshId, meshId))
      .orderBy(desc(transmissions.createdAt))
      .limit(50);

    return reply.send({ transmissions: messages });
  });
};

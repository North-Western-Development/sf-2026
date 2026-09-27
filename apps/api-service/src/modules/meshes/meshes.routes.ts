import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  or,
  asc,
  desc,
  subspaceMeshes,
  subspaceMeshMembers,
  transmissions,
  transmitters,
  affiliations,
  signalBlacklist,
} from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { loadChannel } from '../../lib/channels.js';
import { touchChannelLastTransmission } from '../../lib/read-state.js';
import { AUTHOR_FIELDS, formatTransmission } from '../../lib/transmissions.js';

const MAX_MESH_MEMBERS = 10;
const MAX_TRANSMISSION_LENGTH = 2000;

async function isAffiliatedAndNotBlocking(db: any, callerId: string, targetId: string): Promise<{ ok: boolean; reason?: string }> {
  const [blocked] = await db
    .select()
    .from(signalBlacklist)
    .where(and(eq(signalBlacklist.transmitterId, targetId), eq(signalBlacklist.targetId, callerId), eq(signalBlacklist.targetType, 'transmitter')))
    .limit(1);
  if (blocked) return { ok: false, reason: 'SIGNAL_BLOCKED' };

  const [friendship] = await db
    .select()
    .from(affiliations)
    .where(
      and(
        eq(affiliations.status, 'accepted'),
        or(
          and(eq(affiliations.transmitterId, callerId), eq(affiliations.targetId, targetId)),
          and(eq(affiliations.transmitterId, targetId), eq(affiliations.targetId, callerId))
        )
      )
    )
    .limit(1);
  if (!friendship) return { ok: false, reason: 'NOT_AFFILIATED' };
  return { ok: true };
}

export const meshRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/meshes
   * Create a Subspace Mesh (Group DM, max 10 members). Every memberIds entry must be
   * affiliated with the caller and not blocking them.
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

    const requested = Array.isArray(memberIds) ? [...new Set(memberIds)] as string[] : [];
    const uniqueMembers = [...new Set([token.transmitterId, ...requested])];

    if (uniqueMembers.length > MAX_MESH_MEMBERS) {
      return reply.status(400).send({
        error: `Subspace Meshes support a maximum of ${MAX_MESH_MEMBERS} members`,
        code: 'MESH_CAPACITY_EXCEEDED',
      });
    }

    for (const memberId of requested) {
      const check = await isAffiliatedAndNotBlocking(db, token.transmitterId, memberId);
      if (!check.ok) {
        return reply.status(403).send({ error: 'Every member must be affiliated with the creator', code: check.reason });
      }
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

    await publishSessionRefresh(app, uniqueMembers);
    await publishGatewayEvent(app, 'MESH_CREATE', { mesh: newMesh }, { transmitterIds: uniqueMembers });

    return reply.status(201).send({
      message: 'Subspace Mesh initialized',
      mesh: newMesh,
      memberCount: uniqueMembers.length,
    });
  });

  /**
   * GET /api/v1/meshes
   * List all meshes the caller belongs to, with member profiles and last activity.
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
        lastTransmissionId: subspaceMeshes.lastTransmissionId,
        lastTransmissionAt: subspaceMeshes.lastTransmissionAt,
        createdAt: subspaceMeshes.createdAt,
      })
      .from(subspaceMeshMembers)
      .innerJoin(subspaceMeshes, eq(subspaceMeshMembers.meshId, subspaceMeshes.id))
      .where(eq(subspaceMeshMembers.transmitterId, token.transmitterId));

    const out = [];
    for (const mesh of userMeshes) {
      const memberRows = await db.select({ transmitterId: subspaceMeshMembers.transmitterId }).from(subspaceMeshMembers).where(eq(subspaceMeshMembers.meshId, mesh.id));
      const members = memberRows.length
        ? await db.select(AUTHOR_FIELDS).from(transmitters).where(or(...memberRows.map((m: any) => eq(transmitters.id, m.transmitterId))))
        : [];
      out.push({ ...mesh, members });
    }

    return reply.send({ meshes: out });
  });

  /**
   * PATCH /api/v1/meshes/:id
   */
  app.patch('/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: meshId } = request.params as { id: string };
    const [member] = await db
      .select()
      .from(subspaceMeshMembers)
      .where(and(eq(subspaceMeshMembers.meshId, meshId), eq(subspaceMeshMembers.transmitterId, token.transmitterId)))
      .limit(1);
    if (!member) return reply.status(404).send({ error: 'Subspace Mesh not found' });

    const body = request.body as any;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body?.name === 'string' && body.name.trim().length > 0) updates.name = body.name.trim();
    if (body?.iconUrl !== undefined) updates.iconUrl = body.iconUrl || null;

    const [updated] = await db.update(subspaceMeshes).set(updates).where(eq(subspaceMeshes.id, meshId)).returning();

    const memberRows = await db.select({ transmitterId: subspaceMeshMembers.transmitterId }).from(subspaceMeshMembers).where(eq(subspaceMeshMembers.meshId, meshId));
    await publishGatewayEvent(app, 'MESH_UPDATE', { mesh: updated }, { transmitterIds: memberRows.map((m: any) => m.transmitterId) });

    return reply.send({ message: 'Subspace Mesh updated', mesh: updated });
  });

  /**
   * POST /api/v1/meshes/:meshId/members
   * Add a member (must be affiliated with the caller, capped at 10).
   */
  app.post('/:meshId/members', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { meshId } = request.params as { meshId: string };
    const body = request.body as any;
    const { targetId } = body || {};

    if (!targetId) return reply.status(400).send({ error: 'targetId required' });

    const [callerMember] = await db
      .select()
      .from(subspaceMeshMembers)
      .where(and(eq(subspaceMeshMembers.meshId, meshId), eq(subspaceMeshMembers.transmitterId, token.transmitterId)))
      .limit(1);

    if (!callerMember) return reply.status(403).send({ error: 'Not a member of this Subspace Mesh' });

    const existingMembers = await db.select().from(subspaceMeshMembers).where(eq(subspaceMeshMembers.meshId, meshId));

    if (existingMembers.some((m: any) => m.transmitterId === targetId)) {
      return reply.status(409).send({ error: 'Transmitter is already a member' });
    }

    if (existingMembers.length >= MAX_MESH_MEMBERS) {
      return reply.status(400).send({
        error: `Subspace Mesh has reached maximum capacity of ${MAX_MESH_MEMBERS} members`,
        code: 'MESH_CAPACITY_EXCEEDED',
      });
    }

    const check = await isAffiliatedAndNotBlocking(db, token.transmitterId, targetId);
    if (!check.ok) {
      return reply.status(403).send({ error: 'Target must be affiliated with the caller', code: check.reason });
    }

    await db.insert(subspaceMeshMembers).values({ meshId, transmitterId: targetId });

    const allMembers = [...existingMembers.map((m: any) => m.transmitterId), targetId];
    await publishSessionRefresh(app, allMembers);
    const [mesh] = await db.select().from(subspaceMeshes).where(eq(subspaceMeshes.id, meshId)).limit(1);
    await publishGatewayEvent(app, 'MESH_UPDATE', { mesh }, { transmitterIds: allMembers });

    return reply.status(201).send({
      message: 'Transmitter affiliated with Subspace Mesh',
      memberCount: existingMembers.length + 1,
    });
  });

  /**
   * DELETE /api/v1/meshes/:id/members/@me
   * Leave the mesh; ownership passes to the oldest remaining member. Last one out deletes the mesh.
   */
  app.delete('/:id/members/@me', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: meshId } = request.params as { id: string };
    const [mesh] = await db.select().from(subspaceMeshes).where(eq(subspaceMeshes.id, meshId)).limit(1);
    if (!mesh) return reply.status(404).send({ error: 'Subspace Mesh not found' });

    const [member] = await db
      .select()
      .from(subspaceMeshMembers)
      .where(and(eq(subspaceMeshMembers.meshId, meshId), eq(subspaceMeshMembers.transmitterId, token.transmitterId)))
      .limit(1);
    if (!member) return reply.status(404).send({ error: 'Not a member of this Subspace Mesh' });

    await db.delete(subspaceMeshMembers).where(and(eq(subspaceMeshMembers.meshId, meshId), eq(subspaceMeshMembers.transmitterId, token.transmitterId)));

    const remaining = await db.select().from(subspaceMeshMembers).where(eq(subspaceMeshMembers.meshId, meshId)).orderBy(asc(subspaceMeshMembers.joinedAt));

    if (remaining.length === 0) {
      await db.delete(subspaceMeshes).where(eq(subspaceMeshes.id, meshId));
      await publishGatewayEvent(app, 'MESH_DELETE', { meshId }, { transmitterIds: [token.transmitterId] });
      return reply.send({ message: 'Subspace Mesh disbanded' });
    }

    let updatedMesh = mesh;
    if (mesh.ownerId === token.transmitterId) {
      const newOwnerId = remaining[0].transmitterId;
      [updatedMesh] = await db.update(subspaceMeshes).set({ ownerId: newOwnerId, updatedAt: new Date() }).where(eq(subspaceMeshes.id, meshId)).returning();
    }

    const memberIds = remaining.map((m: any) => m.transmitterId);
    await publishSessionRefresh(app, [...memberIds, token.transmitterId]);
    await publishGatewayEvent(app, 'MESH_UPDATE', { mesh: updatedMesh }, { transmitterIds: [...memberIds, token.transmitterId] });

    return reply.send({ message: 'Departed from Subspace Mesh', mesh: updatedMesh });
  });

  /**
   * DELETE /api/v1/meshes/:id/members/:userId (owner only)
   */
  app.delete('/:id/members/:userId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: meshId, userId } = request.params as { id: string; userId: string };
    const [mesh] = await db.select().from(subspaceMeshes).where(eq(subspaceMeshes.id, meshId)).limit(1);
    if (!mesh) return reply.status(404).send({ error: 'Subspace Mesh not found' });
    if (mesh.ownerId !== token.transmitterId) return reply.status(403).send({ error: 'Only the Mesh owner may remove members' });

    const membersBefore = await db.select().from(subspaceMeshMembers).where(eq(subspaceMeshMembers.meshId, meshId));
    await db.delete(subspaceMeshMembers).where(and(eq(subspaceMeshMembers.meshId, meshId), eq(subspaceMeshMembers.transmitterId, userId)));

    await publishSessionRefresh(app, membersBefore.map((m: any) => m.transmitterId));
    await publishGatewayEvent(app, 'MESH_UPDATE', { mesh }, { transmitterIds: membersBefore.map((m: any) => m.transmitterId) });

    return reply.send({ message: 'Removed from Subspace Mesh' });
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

    const channel = await loadChannel(db, 'mesh', meshId);
    if (channel) await touchChannelLastTransmission(db, channel, newMsg.id, newMsg.createdAt);

    const formatted = await formatTransmission(db, newMsg, token.transmitterId);

    await publishGatewayEvent(
      app,
      'MESH_TRANSMISSION_CREATE',
      { mesh_id: meshId, sender_id: token.transmitterId, transmission: formatted },
      { meshId }
    );

    return reply.status(201).send({
      message: 'Mesh transmission dispatched',
      transmission: formatted,
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

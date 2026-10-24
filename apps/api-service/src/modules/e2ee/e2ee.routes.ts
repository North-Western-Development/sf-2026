import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  and,
  eq,
  sql,
  inArray,
  e2eeDevices,
  e2eeOneTimePreKeys,
  pointToPointLinks,
  transmissions,
  resolvePresencePeers,
} from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { formatTransmission } from '../../lib/transmissions.js';

const MAX_DEVICES = 10;
const MAX_PREKEYS = 100;
const KEY = { type: 'string', pattern: '^[A-Za-z0-9_-]{40,200}$' };
const SIGNED_PREKEY = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'key', 'signature'],
  properties: { id: { type: 'integer', minimum: 0 }, key: KEY, signature: { type: 'string', pattern: '^[A-Za-z0-9_-]{40,200}$' } },
};
const PREKEYS = {
  type: 'array',
  maxItems: MAX_PREKEYS,
  items: { type: 'object', additionalProperties: false, required: ['id', 'key'], properties: { id: { type: 'integer', minimum: 0 }, key: KEY } },
};

const publicDevice = (d: any) => ({ id: d.id, name: d.name, identityKey: d.identityKey, signingKey: d.signingKey, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt });

/**
 * End-to-end encryption plumbing. The server keeps public keys, hands out one-time prekeys
 * once each, relays ciphertext it cannot read, and refuses plaintext in encrypted links.
 */
export const e2eeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function ownDevice(transmitterId: string, deviceId: string) {
    const [device] = await db
      .select()
      .from(e2eeDevices)
      .where(and(eq(e2eeDevices.id, deviceId), eq(e2eeDevices.transmitterId, transmitterId)))
      .limit(1);
    return device ?? null;
  }

  /** Someone may see another's devices only with a reason to talk to them (or it is themselves). */
  async function mayReach(callerId: string, targetId: string) {
    if (callerId === targetId) return true;
    return (await resolvePresencePeers(db, targetId)).includes(callerId);
  }

  /** POST /api/v1/e2ee/devices — register this browser/app's keys. */
  app.post(
    '/devices',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['identityKey', 'signingKey', 'signedPreKey', 'oneTimePreKeys'],
          properties: { name: { type: 'string', maxLength: 64 }, identityKey: KEY, signingKey: KEY, signedPreKey: SIGNED_PREKEY, oneTimePreKeys: PREKEYS },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const body = request.body as { name?: string; identityKey: string; signingKey: string; signedPreKey: any; oneTimePreKeys: Array<{ id: number; key: string }> };
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(e2eeDevices).where(eq(e2eeDevices.transmitterId, token.transmitterId));
      if (count >= MAX_DEVICES) return reply.status(400).send({ error: `You can have up to ${MAX_DEVICES} encryption devices; remove one first`, code: 'TOO_MANY_DEVICES' });
      const [device] = await db
        .insert(e2eeDevices)
        .values({ transmitterId: token.transmitterId, name: body.name?.trim() || 'Device', identityKey: body.identityKey, signingKey: body.signingKey, signedPreKey: body.signedPreKey })
        .returning();
      if (body.oneTimePreKeys.length) {
        await db.insert(e2eeOneTimePreKeys).values(body.oneTimePreKeys.map((k) => ({ deviceId: device.id, keyId: k.id, publicKey: k.key })));
      }
      return reply.status(201).send({ device: publicDevice(device) });
    }
  );

  /** GET /api/v1/e2ee/devices — my devices. */
  app.get('/devices', async (request, reply) => {
    const token = extractAuthToken(request)!;
    const rows = await db.select().from(e2eeDevices).where(eq(e2eeDevices.transmitterId, token.transmitterId));
    return reply.send({ devices: rows.map(publicDevice) });
  });

  /** DELETE /api/v1/e2ee/devices/:id — forget a device (it can no longer receive messages). */
  app.delete('/devices/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { id } = request.params as { id: string };
    const removed = await db.delete(e2eeDevices).where(and(eq(e2eeDevices.id, id), eq(e2eeDevices.transmitterId, token.transmitterId))).returning();
    if (!removed.length) return reply.status(404).send({ error: 'Device not found' });
    return reply.status(204).send();
  });

  /** GET /api/v1/e2ee/devices/:id/prekeys — how many one-time prekeys remain (the device tops up). */
  app.get('/devices/:id/prekeys', { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { id } = request.params as { id: string };
    if (!(await ownDevice(token.transmitterId, id))) return reply.status(404).send({ error: 'Device not found' });
    await db.update(e2eeDevices).set({ lastSeenAt: new Date() }).where(eq(e2eeDevices.id, id));
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(e2eeOneTimePreKeys).where(eq(e2eeOneTimePreKeys.deviceId, id));
    return reply.send({ remaining: count });
  });

  /** POST /api/v1/e2ee/devices/:id/prekeys  { oneTimePreKeys } */
  app.post(
    '/devices/:id/prekeys',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', additionalProperties: false, required: ['oneTimePreKeys'], properties: { oneTimePreKeys: PREKEYS } },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      const { id } = request.params as { id: string };
      if (!(await ownDevice(token.transmitterId, id))) return reply.status(404).send({ error: 'Device not found' });
      const keys = (request.body as { oneTimePreKeys: Array<{ id: number; key: string }> }).oneTimePreKeys;
      if (keys.length) await db.insert(e2eeOneTimePreKeys).values(keys.map((k) => ({ deviceId: id, keyId: k.id, publicKey: k.key }))).onConflictDoNothing();
      return reply.status(204).send();
    }
  );

  /** GET /api/v1/e2ee/users/:userId/devices — a user's devices (public keys only). */
  app.get('/users/:userId/devices', { schema: { params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { userId } = request.params as { userId: string };
    if (!(await mayReach(token.transmitterId, userId))) return reply.status(404).send({ error: 'Transmitter not found' });
    const rows = await db.select().from(e2eeDevices).where(eq(e2eeDevices.transmitterId, userId));
    return reply.send({ devices: rows.map(publicDevice) });
  });

  /**
   * POST /api/v1/e2ee/devices/:id/bundle
   * A device's prekey bundle for starting a session, claiming (deleting) one one-time prekey.
   */
  app.post('/devices/:id/bundle', { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { id } = request.params as { id: string };
    const [device] = await db.select().from(e2eeDevices).where(eq(e2eeDevices.id, id)).limit(1);
    if (!device || !(await mayReach(token.transmitterId, device.transmitterId))) return reply.status(404).send({ error: 'Device not found' });
    const [claimed] = await db.execute(sql`
      DELETE FROM e2ee_one_time_pre_keys
      WHERE (device_id, key_id) = (SELECT device_id, key_id FROM e2ee_one_time_pre_keys WHERE device_id = ${id} ORDER BY key_id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING key_id, public_key`).then((r: any) => r.rows ?? r);
    return reply.send({
      bundle: {
        deviceId: device.id,
        identityKey: device.identityKey,
        signingKey: device.signingKey,
        signedPreKey: device.signedPreKey,
        oneTimePreKey: claimed ? { id: claimed.key_id, key: claimed.public_key } : null,
      },
    });
  });

  /**
   * POST /api/v1/e2ee/links/:linkId/enable
   * Turn on end-to-end encryption for a direct link. One-way: it cannot be turned off.
   * Both people need at least one encryption device.
   */
  app.post('/links/:linkId/enable', { schema: { params: { type: 'object', properties: { linkId: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { linkId } = request.params as { linkId: string };
    const [link] = await db.select().from(pointToPointLinks).where(eq(pointToPointLinks.id, linkId)).limit(1);
    if (!link || ![link.transmitter1Id, link.transmitter2Id].includes(token.transmitterId)) return reply.status(404).send({ error: 'Direct link not found' });
    if (link.encryptedAt) return reply.send({ encryptedAt: link.encryptedAt });
    const other = link.transmitter1Id === token.transmitterId ? link.transmitter2Id : link.transmitter1Id;
    const owners = await db.select({ transmitterId: e2eeDevices.transmitterId }).from(e2eeDevices).where(inArray(e2eeDevices.transmitterId, [token.transmitterId, other]));
    const ready = new Set(owners.map((o: any) => o.transmitterId));
    if (!ready.has(token.transmitterId)) return reply.status(409).send({ error: 'This device is not set up for encryption yet', code: 'NO_DEVICE' });
    if (!ready.has(other)) return reply.status(409).send({ error: 'They need to open Subspace on a device that supports encryption first', code: 'RECIPIENT_NO_DEVICE' });
    const [updated] = await db.update(pointToPointLinks).set({ encryptedAt: new Date() }).where(eq(pointToPointLinks.id, linkId)).returning();
    // A visible marker in the conversation, from the person who turned it on.
    const [marker] = await db.insert(transmissions).values({ p2pLinkId: linkId, transmitterId: token.transmitterId, content: '', type: 'system_encryption' }).returning();
    const formatted = await formatTransmission(db, marker, token.transmitterId);
    const audience = { transmitterIds: [link.transmitter1Id, link.transmitter2Id] };
    await publishGatewayEvent(app, 'LINK_ENCRYPTION_ENABLED', { linkId, encryptedAt: updated.encryptedAt }, audience);
    await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: 'link', channelId: linkId, transmission: formatted }, audience);
    return reply.send({ encryptedAt: updated.encryptedAt });
  });

  /**
   * POST /api/v1/e2ee/signal  { to, envelope, call? }
   * Relay an encrypted envelope to someone's devices (call frame keys). The server cannot read
   * it and only forwards between people who could already message each other.
   */
  app.post(
    '/signal',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['to', 'fromDevice', 'toDevice', 'envelope'],
          properties: {
            to: { type: 'string', format: 'uuid' },
            fromDevice: { type: 'string', format: 'uuid' },
            toDevice: { type: 'string', format: 'uuid' },
            envelope: { type: 'object' },
            topic: { type: 'string', maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      const body = request.body as { to: string; fromDevice: string; toDevice: string; envelope: unknown; topic?: string };
      if (JSON.stringify(body.envelope).length > 16_384) return reply.status(413).send({ error: 'Envelope too large' });
      if (!(await ownDevice(token.transmitterId, body.fromDevice))) return reply.status(404).send({ error: 'Device not found' });
      if (!(await mayReach(token.transmitterId, body.to))) return reply.status(404).send({ error: 'Transmitter not found' });
      await publishGatewayEvent(
        app,
        'E2EE_SIGNAL',
        { from: token.transmitterId, fromDevice: body.fromDevice, toDevice: body.toDevice, envelope: body.envelope, topic: body.topic ?? null },
        { transmitterIds: [body.to] }
      );
      return reply.status(202).send({ relayed: true });
    }
  );
};

/** Whether a direct link only accepts ciphertext. */
export async function linkIsEncrypted(db: any, linkId: string): Promise<boolean> {
  const [link] = await db.select({ encryptedAt: pointToPointLinks.encryptedAt }).from(pointToPointLinks).where(eq(pointToPointLinks.id, linkId)).limit(1);
  return !!link?.encryptedAt;
}


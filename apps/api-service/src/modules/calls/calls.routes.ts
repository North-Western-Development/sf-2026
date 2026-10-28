import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authorizeCall, transmissions } from '@subspace/database';
import { requireSecret } from '@subspace/crypto';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { createLiveKitAccessToken, forceRelay } from '../media/livekit.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { formatTransmission } from '../../lib/transmissions.js';
import { loadChannel } from '../../lib/channels.js';
import { touchChannelLastTransmission } from '../../lib/read-state.js';
import { queuePush } from '../../lib/push.js';

const LIVEKIT_API_KEY = requireSecret('LIVEKIT_API_KEY', 'subspace_api_key');
const LIVEKIT_API_SECRET = requireSecret('LIVEKIT_API_SECRET', 'subspace_secret_key_frequency');
const LIVEKIT_PUBLIC_URL = process.env.LIVEKIT_PUBLIC_URL || null;

/** A call nobody has joined yet expires, so an abandoned ring cannot linger. */
const UNANSWERED_TTL_SECONDS = 90;

/**
 * Calls in direct links and meshes. The API owns the call record (who started it, who is
 * still being rung, the "started a call" transmission); the gateway tracks who is connected
 * through voice states and ends the call when the last person leaves.
 *
 * Redis: `call:<type>:<id>` JSON record, `call:<type>:<id>:joined` set of everyone who joined.
 */
export interface CallRecord {
  channelType: 'link' | 'mesh';
  channelId: string;
  messageId: string;
  startedBy: string;
  startedAt: string;
  ringing: string[];
  participants: string[];
}

export const callKey = (type: string, id: string) => `call:${type}:${id}`;
export const callRoom = (type: string, id: string) => `call-${type}-${id}`;

const params = {
  type: 'object',
  required: ['channelType', 'channelId'],
  properties: { channelType: { type: 'string', enum: ['link', 'mesh'] }, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
};

const publicCall = (c: CallRecord) => ({
  channelType: c.channelType,
  channelId: c.channelId,
  messageId: c.messageId,
  startedBy: c.startedBy,
  startedAt: c.startedAt,
  ringing: c.ringing,
});

export const callRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = (app as any).redis;

  async function readCall(type: string, id: string): Promise<CallRecord | null> {
    const raw = await redis.get(callKey(type, id));
    return raw ? (JSON.parse(raw) as CallRecord) : null;
  }
  async function writeCall(call: CallRecord, ttl?: number) {
    const key = callKey(call.channelType, call.channelId);
    if (ttl) await redis.set(key, JSON.stringify(call), 'EX', ttl);
    else await redis.set(key, JSON.stringify(call), 'KEEPTTL');
  }
  const announce = (type: 'CALL_CREATE' | 'CALL_UPDATE', call: CallRecord) =>
    publishGatewayEvent(app, type, publicCall(call), { transmitterIds: call.participants });

  /**
   * GET /api/v1/calls?channels=link:<id>,mesh:<id>
   * The active calls among the given conversations (the client passes its own DMs).
   */
  app.get(
    '/',
    { schema: { querystring: { type: 'object', properties: { channels: { type: 'string', maxLength: 20000 } } } } },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      if (!db || !redis) return reply.status(503).send({ error: 'Service unavailable' });
      const wanted = String((request.query as any).channels || '')
        .split(',')
        .map((k) => k.split(':'))
        .filter(([t, id]) => (t === 'link' || t === 'mesh') && /^[1-9][0-9]{0,18}$/.test(id ?? ''))
        .slice(0, 200);
      const calls = [];
      for (const [type, id] of wanted) {
        const call = await readCall(type, id);
        if (call && call.participants.includes(token.transmitterId)) calls.push(publicCall(call));
      }
      return reply.send({ calls });
    }
  );

  /**
   * POST /api/v1/calls/:channelType/:channelId/ring
   * Start a call (posting "X started a call") or, if one is running, ring the others again.
   */
  app.post('/:channelType/:channelId/ring', { schema: { params } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db || !redis) return reply.status(503).send({ error: 'Service unavailable' });
    const { channelType, channelId } = request.params as { channelType: 'link' | 'mesh'; channelId: string };
    const participants = await authorizeCall(db, token.transmitterId, channelType, channelId);
    if (!participants) return reply.status(404).send({ error: 'Conversation not found', code: 'CALL_FORBIDDEN' });

    const existing = await readCall(channelType, channelId);
    if (existing) {
      const joined = new Set<string>(await redis.smembers(`${callKey(channelType, channelId)}:joined`));
      existing.ringing = [...new Set([...existing.ringing, ...participants.filter((p) => p !== token.transmitterId && !joined.has(p))])];
      await writeCall(existing);
      await announce('CALL_UPDATE', existing);
      return reply.send({ call: publicCall(existing) });
    }

    const startedAt = new Date();
    const [message] = await db
      .insert(transmissions)
      .values({
        [channelType === 'link' ? 'p2pLinkId' : 'meshId']: channelId,
        transmitterId: token.transmitterId,
        content: JSON.stringify({ startedAt: startedAt.toISOString() }),
        type: 'system_call',
      })
      .returning();
    const channel = await loadChannel(db, channelType, channelId);
    if (channel) await touchChannelLastTransmission(db, channel, message.id, message.createdAt);
    const formatted = await formatTransmission(db, message, token.transmitterId);
    await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType, channelId, transmission: formatted }, { transmitterIds: participants });

    const call: CallRecord = {
      channelType,
      channelId,
      messageId: message.id,
      startedBy: token.transmitterId,
      startedAt: startedAt.toISOString(),
      ringing: participants.filter((p) => p !== token.transmitterId),
      participants,
    };
    await writeCall(call, UNANSWERED_TTL_SECONDS);
    await announce('CALL_CREATE', call);
    queuePush(app, call.ringing, { title: 'Incoming call', body: `${formatted.author?.displayName || formatted.author?.username || 'Someone'} is calling`, path: `/channels/@me/${channelId}` }, [
      { type: channelType, id: channelId },
    ]);
    return reply.status(201).send({ call: publicCall(call) });
  });

  /** POST /api/v1/calls/:channelType/:channelId/decline — stop ringing for the caller. */
  app.post('/:channelType/:channelId/decline', { schema: { params } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!redis) return reply.status(503).send({ error: 'Service unavailable' });
    const { channelType, channelId } = request.params as { channelType: string; channelId: string };
    const call = await readCall(channelType, channelId);
    if (!call || !call.participants.includes(token.transmitterId)) return reply.status(404).send({ error: 'No call to decline' });
    if (call.ringing.includes(token.transmitterId)) {
      call.ringing = call.ringing.filter((p) => p !== token.transmitterId);
      await writeCall(call);
      await announce('CALL_UPDATE', call);
    }
    return reply.status(204).send();
  });

  /**
   * POST /api/v1/calls/:channelType/:channelId/token
   * A LiveKit grant for the call's room. Joining stops ringing and keeps the call alive.
   */
  app.post('/:channelType/:channelId/token', { schema: { params } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db || !redis) return reply.status(503).send({ error: 'Service unavailable' });
    const { channelType, channelId } = request.params as { channelType: 'link' | 'mesh'; channelId: string };
    const participants = await authorizeCall(db, token.transmitterId, channelType, channelId);
    if (!participants) return reply.status(404).send({ error: 'Conversation not found', code: 'CALL_FORBIDDEN' });
    const call = await readCall(channelType, channelId);
    if (!call) return reply.status(409).send({ error: 'There is no call to join; start one first', code: 'NO_ACTIVE_CALL' });

    const key = callKey(channelType, channelId);
    await redis.sadd(`${key}:joined`, token.transmitterId);
    await redis.persist(key);
    await redis.persist(`${key}:joined`);
    if (call.ringing.includes(token.transmitterId)) {
      call.ringing = call.ringing.filter((p) => p !== token.transmitterId);
      await writeCall(call);
      await announce('CALL_UPDATE', call);
    }

    const roomName = callRoom(channelType, channelId);
    const grant = createLiveKitAccessToken({
      apiKey: LIVEKIT_API_KEY,
      apiSecret: LIVEKIT_API_SECRET,
      identity: token.transmitterId,
      name: token.username,
      roomName,
      permissions: 0n,
      isOwner: true, // everyone in a DM call may speak, show video and share their screen
    });
    return reply.send({ token: grant, livekitUrl: LIVEKIT_PUBLIC_URL, forceRelay: forceRelay(), roomName, canSpeak: true, canVideo: true, canShareScreen: true, call: publicCall(call) });
  });
};

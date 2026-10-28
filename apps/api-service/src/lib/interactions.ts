import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, transmissions, newSnowflake } from '@subspace/database';
import { resolveSafe, safePost } from './safe-fetch.js';
import { openSecret, hashSecret } from './app-users.js';
import { postAppMessage } from './app-messages.js';
import { publishGatewayEvent } from './events.js';
import { fetchAuthorProfile, formatTransmission } from './transmissions.js';
import { loadChannel } from './channels.js';
import { normalizeRichEmbeds, type RichEmbedInput } from './rich-embeds.js';

/** An interaction endpoint must be public: https (http only outside production), not a private address. */
export async function isSafeOutboundUrl(raw: string): Promise<boolean> {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) return false;
    await resolveSafe(url);
    return true;
  } catch {
    return false;
  }
}

/** Ed25519 over timestamp + body, as Discord signs interaction requests. */
export function signInteraction(privateKeyEnc: string, timestamp: string, body: string): string {
  return crypto.sign(null, Buffer.from(timestamp + body), crypto.createPrivateKey(openSecret(privateKeyEnc))).toString('hex');
}

/** What we keep about an interaction for its 15 minutes (Redis `interaction:<id>`). */
export interface InteractionState {
  id: string;
  tokenHash: string;
  appId: string;
  botUserId: string;
  userId: string;
  beaconId: string;
  channelType: 'relay' | 'thread';
  channelId: string;
  commandName: string;
  createdAt: number;
  /** Answered (a message, ephemeral reply or "thinking"). */
  responded: boolean;
  deferred: boolean;
  ephemeral: boolean;
  /** The message that answered it, for edits. */
  originalId: string | null;
}

export const INTERACTION_TTL_S = 15 * 60;
export const RESPONSE_DEADLINE_MS = 3000;

const key = (id: string) => `interaction:${id}`;
export async function saveInteraction(redis: any, s: InteractionState) {
  await redis.set(key(s.id), JSON.stringify(s), 'EX', INTERACTION_TTL_S);
}
export async function loadInteraction(redis: any, id: string, token?: string): Promise<InteractionState | null> {
  const raw = await redis.get(key(id));
  if (!raw) return null;
  const s = JSON.parse(raw) as InteractionState;
  if (token !== undefined) {
    const a = Buffer.from(s.tokenHash);
    const b = Buffer.from(hashSecret(token));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  }
  return s;
}

/** A bot's answer: content and embeds, shown to everyone or only to the person who used the command. */
export interface InteractionReply {
  content?: string;
  embeds?: RichEmbedInput[];
  ephemeral?: boolean;
}

/**
 * Show a bot's reply. An ephemeral one goes only to the person who used the command and is not
 * kept; anything else is a message in the channel marked with the command that asked for it.
 */
export async function deliverReply(app: FastifyInstance, s: InteractionState, reply: InteractionReply, opts: { asOriginal: boolean }) {
  const db = (app as any).db;
  const embeds = normalizeRichEmbeds(reply.embeds);
  const content = (reply.content ?? '').slice(0, 2000);
  if (!content && !embeds.length) throw new Error('A reply needs content or embeds');
  if (reply.ephemeral) {
    const author = await fetchAuthorProfile(db, s.botUserId);
    const fake = {
      id: `ephemeral-${newSnowflake()}`,
      channelType: s.channelType,
      channelId: s.channelId,
      author,
      content,
      embeds,
      createdAt: new Date().toISOString(),
      attachments: [],
      stickers: [],
      mentions: [],
      mentionRoles: [],
      mentionEveryone: false,
      reactions: [],
      pinned: false,
      ephemeral: true,
      interaction: { name: s.commandName, user: await fetchAuthorProfile(db, s.userId) },
      type: 'default',
    };
    await publishGatewayEvent(app, 'INTERACTION_EPHEMERAL', { interactionId: s.id, channelType: s.channelType, channelId: s.channelId, transmission: fake }, { transmitterIds: [s.userId] });
    return fake;
  }
  const channel = await loadChannel(db, s.channelType, s.channelId);
  if (!channel) throw new Error('The channel is gone');
  const sent = await postAppMessage(app, { channel, authorId: s.botUserId, content, embeds, interaction: { id: s.id, name: s.commandName, userId: s.userId } });
  if (opts.asOriginal) s.originalId = sent.id;
  return sent;
}

/** Edit the message that answered an interaction. */
export async function editOriginal(app: FastifyInstance, s: InteractionState, reply: InteractionReply) {
  const db = (app as any).db;
  if (!s.originalId) return deliverReply(app, s, reply, { asOriginal: true });
  const embeds = normalizeRichEmbeds(reply.embeds);
  const [row] = await db
    .update(transmissions)
    .set({ ...(reply.content !== undefined ? { content: reply.content.slice(0, 2000) } : {}), ...(reply.embeds ? { embeds } : {}), isEdited: true, updatedAt: new Date() })
    .where(eq(transmissions.id, s.originalId))
    .returning();
  const channel = await loadChannel(db, s.channelType, s.channelId);
  const formatted = await formatTransmission(db, row, s.botUserId, { beaconId: s.beaconId });
  const { audienceForChannel } = await import('./channels.js');
  await publishGatewayEvent(app, 'TRANSMISSION_UPDATE', { channelType: s.channelType, channelId: s.channelId, transmission: formatted }, audienceForChannel(channel!));
  return formatted;
}

/** POST the interaction to the bot's endpoint, signed; its answer, or null. */
export async function postToEndpoint(url: string, privateKeyEnc: string, payload: unknown): Promise<{ type: number; data?: InteractionReply } | null> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await safePost(url, body, { 'X-Signature-Ed25519': signInteraction(privateKeyEnc, timestamp, body), 'X-Signature-Timestamp': timestamp }, { timeoutMs: RESPONSE_DEADLINE_MS });
  if (res.status < 200 || res.status >= 300) return null;
  try {
    return JSON.parse(res.body.toString('utf8'));
  } catch {
    return null;
  }
}

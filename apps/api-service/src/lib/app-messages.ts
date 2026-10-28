import type { FastifyInstance } from 'fastify';
import { transmissions, resolveRelayAudience } from '@subspace/database';
import { publishGatewayEvent } from './events.js';
import { audienceForChannel, type LoadedChannel } from './channels.js';
import { formatTransmission } from './transmissions.js';
import { parseMentions } from './mentions.js';
import { touchChannelLastTransmission, incrementMentionCounts } from './read-state.js';
import { scheduleEmbeds, type Embed } from './embeds.js';

export interface AppMessage {
  /** Where it goes: a relay or thread (webhooks and bots post in beacons). */
  channel: LoadedChannel;
  /** The webhook's or bot's own account. */
  authorId: string;
  content: string;
  embeds?: Embed[];
  /** A webhook's per-message name and avatar. */
  override?: { name: string; avatarUrl: string | null } | null;
  webhookId?: string | null;
  interaction?: { id: string; name: string; userId: string } | null;
  /** Files, as stored on another transmission (a published announcement's copy). */
  attachments?: unknown[];
  /** A published announcement's copy: where it came from. It never pings anyone here. */
  crosspost?: { beaconId: string; beaconName: string; relayId: string; relayName: string; transmissionId: string } | null;
}

const COLUMN = { relay: 'relayId', thread: 'threadId', link: 'p2pLinkId', mesh: 'meshId' } as const;

/**
 * Write a message from a webhook or bot and deliver it like any other: mentions counted, link
 * previews fetched, TRANSMISSION_CREATE to whoever can see the channel. Apps never ping
 * @everyone or @here, and mention clearances only when they are mentionable.
 */
export async function postAppMessage(app: FastifyInstance, msg: AppMessage) {
  const db = (app as any).db;
  const { channel } = msg;
  const validUserIds = new Set<string>(channel.relayId ? await resolveRelayAudience(db, channel.relayId) : channel.participants ?? []);
  const parsed = msg.crosspost
    ? { mentions: [] as string[], mentionRoles: [] as string[] }
    : await parseMentions(db, msg.content, { beaconId: channel.beaconId ?? null, validUserIds, authorHasMentionEveryone: false });
  const [row] = await db
    .insert(transmissions)
    .values({
      [COLUMN[channel.channelType]]: channel.channelId,
      transmitterId: msg.authorId,
      content: msg.content,
      embeds: msg.embeds ?? [],
      mentions: parsed.mentions,
      mentionRoles: parsed.mentionRoles,
      mentionEveryone: false,
      webhookId: msg.webhookId ?? null,
      authorOverride: msg.override ?? null,
      interaction: msg.interaction ?? null,
      attachments: (msg.attachments ?? []) as any,
      crosspost: msg.crosspost ?? null,
      type: 'default',
    })
    .returning();
  await touchChannelLastTransmission(db, channel, row.id, row.createdAt);
  await incrementMentionCounts(
    db,
    channel,
    msg.authorId,
    [...validUserIds].map((id) => ({ recipientId: id, isMentionTarget: parsed.mentions.includes(id), isEveryoneOnly: false }))
  );
  const formatted = await formatTransmission(db, row, msg.authorId, { beaconId: channel.beaconId });
  await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: channel.channelType, channelId: channel.channelId, transmission: formatted }, audienceForChannel(channel));
  scheduleEmbeds(app, row);
  return formatted;
}

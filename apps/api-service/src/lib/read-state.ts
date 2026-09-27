import { eq, sql, and, or, relays, pointToPointLinks, subspaceMeshes, archivalThreads, readStates, signalBlacklist, pointToPointLinkHidden } from '@subspace/database';
import { LoadedChannel } from './channels.js';
import { resolveEffectiveNotification, defaultLevelForRelay, ScopeRef } from './notifications.js';

const TABLE_FOR: Record<string, any> = {
  relay: relays,
  link: pointToPointLinks,
  mesh: subspaceMeshes,
  thread: archivalThreads,
};

/** Updates the channel container's `lastTransmissionId`/`lastTransmissionAt` pointer columns. */
export async function touchChannelLastTransmission(
  db: any,
  channel: LoadedChannel,
  transmissionId: string,
  at: Date
): Promise<void> {
  const table = TABLE_FOR[channel.channelType];
  if (!table || !db) return;
  await db
    .update(table)
    .set({ lastTransmissionId: transmissionId, lastTransmissionAt: at })
    .where(eq(table.id, channel.channelId));

  // A new message un-hides a Point-to-Point Link from every participant's DM list.
  if (channel.channelType === 'link') {
    await db.delete(pointToPointLinkHidden).where(eq(pointToPointLinkHidden.linkId, channel.channelId));
  }
}

async function scopeChainFor(db: any, channel: LoadedChannel): Promise<{ chain: ScopeRef[]; defaultLevel: 'all' | 'mentions' }> {
  if (channel.channelType === 'relay' || channel.channelType === 'thread') {
    const [relay] = await db.select().from(relays).where(eq(relays.id, channel.relayId!)).limit(1);
    const chain: ScopeRef[] = [{ scopeType: 'relay', scopeId: channel.relayId! }];
    if (relay?.parentId) chain.push({ scopeType: 'category', scopeId: relay.parentId });
    chain.push({ scopeType: 'beacon', scopeId: channel.beaconId! });
    chain.push({ scopeType: 'global', scopeId: '@global' });
    const defaultLevel = await defaultLevelForRelay(db, channel.beaconId!);
    return { chain, defaultLevel };
  }
  if (channel.channelType === 'link') {
    return { chain: [{ scopeType: 'link', scopeId: channel.channelId }, { scopeType: 'global', scopeId: '@global' }], defaultLevel: 'all' };
  }
  return { chain: [{ scopeType: 'mesh', scopeId: channel.channelId }, { scopeType: 'global', scopeId: '@global' }], defaultLevel: 'all' };
}

export interface MentionRecipientCheck {
  recipientId: string;
  isMentionTarget: boolean; // direct/role mention, or reply ping, or every-message container (DM/mesh)
  isEveryoneOnly: boolean; // recipient only counted via @everyone/@here
}

/**
 * Increments `mention_count` on each recipient's read state row for this channel,
 * honoring notification-setting suppressions, mutes, and blocks. Recipients are all
 * channel members except the sender.
 */
export async function incrementMentionCounts(
  db: any,
  channel: LoadedChannel,
  senderId: string,
  candidates: MentionRecipientCheck[]
): Promise<void> {
  if (!db) return;
  const { chain, defaultLevel } = await scopeChainFor(db, channel);

  for (const candidate of candidates) {
    if (candidate.recipientId === senderId || !candidate.isMentionTarget) continue;

    const [blockedBySender] = await db
      .select()
      .from(signalBlacklist)
      .where(
        and(
          eq(signalBlacklist.transmitterId, candidate.recipientId),
          eq(signalBlacklist.targetId, senderId),
          eq(signalBlacklist.targetType, 'transmitter')
        )
      )
      .limit(1);
    if (blockedBySender) continue;

    const effective = await resolveEffectiveNotification(db, candidate.recipientId, chain, defaultLevel);
    if (effective.level === 'nothing' || effective.muted) continue;
    if (candidate.isEveryoneOnly && effective.suppressEveryone) continue;

    await db
      .insert(readStates)
      .values({
        transmitterId: candidate.recipientId,
        channelType: channel.channelType,
        channelId: channel.channelId,
        mentionCount: 1,
      })
      .onConflictDoUpdate({
        target: [readStates.transmitterId, readStates.channelType, readStates.channelId],
        set: { mentionCount: sql`${readStates.mentionCount} + 1` },
      });
  }
}

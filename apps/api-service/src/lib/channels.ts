import {
  eq,
  and,
  or,
  relays,
  archivalThreads,
  pointToPointLinks,
  subspaceMeshes,
  subspaceMeshMembers,
  signalBlacklist,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { resolveBeaconActorContext, resolveRelayActorContext, ClearanceContext } from '../middleware/hierarchy.js';
import { Audience } from './events.js';
import { dmAccess } from './dm-access.js';

export type ChannelType = 'relay' | 'link' | 'mesh' | 'thread';
export const CHANNEL_TYPES: ChannelType[] = ['relay', 'link', 'mesh', 'thread'];

export interface LoadedChannel {
  channelType: ChannelType;
  channelId: string;
  beaconId?: string;
  /** For relay: same as channelId. For thread: the parent relay id. */
  relayId?: string;
  threadLocked?: boolean;
  participants?: string[];
}

export async function loadChannel(db: any, channelType: string, channelId: string): Promise<LoadedChannel | null> {
  if (!db) return null;
  if (channelType === 'relay') {
    const [relay] = await db.select().from(relays).where(eq(relays.id, channelId)).limit(1);
    if (!relay) return null;
    return { channelType: 'relay', channelId, beaconId: relay.beaconId, relayId: relay.id };
  }
  if (channelType === 'thread') {
    const [thread] = await db.select().from(archivalThreads).where(eq(archivalThreads.id, channelId)).limit(1);
    if (!thread) return null;
    const [relay] = await db.select().from(relays).where(eq(relays.id, thread.relayId)).limit(1);
    if (!relay) return null;
    return {
      channelType: 'thread',
      channelId,
      beaconId: relay.beaconId,
      relayId: relay.id,
      threadLocked: thread.isLocked,
    };
  }
  if (channelType === 'link') {
    const [link] = await db.select().from(pointToPointLinks).where(eq(pointToPointLinks.id, channelId)).limit(1);
    if (!link) return null;
    return { channelType: 'link', channelId, participants: [link.transmitter1Id, link.transmitter2Id] };
  }
  if (channelType === 'mesh') {
    const [mesh] = await db.select().from(subspaceMeshes).where(eq(subspaceMeshes.id, channelId)).limit(1);
    if (!mesh) return null;
    return { channelType: 'mesh', channelId };
  }
  return null;
}

export type ChannelAction = 'view' | 'send' | 'attach' | 'manage' | 'pin' | 'react';

export interface ChannelAccess {
  allowed: boolean;
  status: number;
  error?: string;
  code?: string;
  actorContext?: ClearanceContext;
}

const RELAY_PERMISSION_FOR: Record<ChannelAction, bigint> = {
  view: PERMISSIONS.VIEW_RELAY,
  send: PERMISSIONS.SEND_TRANSMISSIONS,
  attach: PERMISSIONS.ATTACH_FILES,
  manage: PERMISSIONS.MANAGE_TRANSMISSIONS,
  pin: PERMISSIONS.PIN_TRANSMISSIONS,
  react: PERMISSIONS.ADD_REACTIONS,
};

export async function checkChannelAccess(
  db: any,
  channel: LoadedChannel,
  transmitterId: string,
  action: ChannelAction
): Promise<ChannelAccess> {
  if (channel.channelType === 'relay' || channel.channelType === 'thread') {
    const actorContext = channel.relayId
      ? await resolveRelayActorContext(db, transmitterId, { id: channel.relayId, beaconId: channel.beaconId! })
      : await resolveBeaconActorContext(db, transmitterId, channel.beaconId!);
    if (!actorContext || !hasPermission(actorContext.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
      return { allowed: false, status: 404, error: 'Channel not found or not visible' };
    }
    if (channel.channelType === 'thread' && channel.threadLocked && action === 'send') {
      if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS)) {
        return { allowed: false, status: 403, error: 'Archival thread is locked', code: 'THREAD_LOCKED', actorContext };
      }
    }
    const required = RELAY_PERMISSION_FOR[action];
    if (action === 'pin') {
      const allowed =
        hasPermission(actorContext.effectivePermissions, PERMISSIONS.PIN_TRANSMISSIONS) ||
        hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS);
      if (!allowed) return { allowed: false, status: 403, error: 'Transmitter lacks PIN_TRANSMISSIONS clearance', actorContext };
      return { allowed: true, status: 200, actorContext };
    }
    if (!hasPermission(actorContext.effectivePermissions, required)) {
      return { allowed: false, status: 403, error: `Transmitter lacks required clearance for this action`, actorContext };
    }
    return { allowed: true, status: 200, actorContext };
  }

  if (channel.channelType === 'link') {
    if (!channel.participants?.includes(transmitterId)) {
      return { allowed: false, status: 404, error: 'Channel not found or not visible' };
    }
    if (action === 'send') {
      const otherId = channel.participants.find((id) => id !== transmitterId)!;
      const [blocked] = await db
        .select()
        .from(signalBlacklist)
        .where(
          or(
            and(
              eq(signalBlacklist.transmitterId, otherId),
              eq(signalBlacklist.targetId, transmitterId),
              eq(signalBlacklist.targetType, 'transmitter')
            ),
            and(
              eq(signalBlacklist.transmitterId, transmitterId),
              eq(signalBlacklist.targetId, otherId),
              eq(signalBlacklist.targetType, 'transmitter')
            )
          )
        )
        .limit(1);
      if (blocked) return { allowed: false, status: 403, error: 'Communication blocked by signal filter', code: 'SIGNAL_BLOCKED' };
      // Like Discord: without an affiliation, the two need a shared beacon where the other allows DMs.
      const access = await dmAccess(db, transmitterId, otherId);
      if (!access.ok) return { allowed: false, status: 403, error: access.error, code: access.code };
    }
    return { allowed: true, status: 200 };
  }

  if (channel.channelType === 'mesh') {
    const [member] = await db
      .select()
      .from(subspaceMeshMembers)
      .where(and(eq(subspaceMeshMembers.meshId, channel.channelId), eq(subspaceMeshMembers.transmitterId, transmitterId)))
      .limit(1);
    if (!member) return { allowed: false, status: 404, error: 'Channel not found or not visible' };
    return { allowed: true, status: 200 };
  }

  return { allowed: false, status: 404, error: 'Unknown channel type' };
}

export function audienceForChannel(channel: LoadedChannel): Audience {
  if (channel.channelType === 'relay' || channel.channelType === 'thread') return { relayId: channel.relayId! };
  if (channel.channelType === 'mesh') return { meshId: channel.channelId };
  return { transmitterIds: channel.participants || [] };
}

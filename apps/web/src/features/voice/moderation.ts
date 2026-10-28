import type { ContextMenuItem } from '@subspace/ui';
import { getState, setState, useStore } from '../../data/store';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { http } from '../../lib/http';
import { toast } from '../../app/ui';
import { useAudioPrefs } from './audioPrefs';
import { joinVoice, leaveVoice, useVoice } from './session';

/**
 * Voice moderation (Discord's server mute, server deafen, move and disconnect). LiveKit
 * enforces it; this keeps my own controls in step and gives moderators their menu items.
 */

const moderate = (beaconId: string, userId: string, body: Record<string, unknown>) =>
  http.patch(`/beacons/${beaconId}/voice-states/${userId}`, body).catch((e) => toast((e as Error).message, 'error'));

/** Menu items for someone connected to voice in this beacon, for moderators. */
export function voiceModerationItems(beaconId: string, userId: string): ContextMenuItem[] {
  const s = getState();
  const vs = s.voice[userId];
  if (!vs?.relayId || vs.beaconId !== beaconId) return [];
  const perms = beaconPermissions(s, beaconId);
  const member = s.members[beaconId]?.[userId];
  const items: ContextMenuItem[] = [];
  if (can(perms, PERMISSIONS.MUTE_MEMBERS)) {
    items.push({ label: 'Server Mute', checked: !!member?.serverMuted, onClick: () => void moderate(beaconId, userId, { mute: !member?.serverMuted }) });
  }
  if (can(perms, PERMISSIONS.DEAFEN_MEMBERS)) {
    items.push({ label: 'Server Deafen', checked: !!member?.serverDeafened, onClick: () => void moderate(beaconId, userId, { deafen: !member?.serverDeafened }) });
  }
  if (can(perms, PERMISSIONS.MOVE_MEMBERS)) {
    const rooms = Object.values(s.relays)
      .filter((r) => r.beaconId === beaconId && (r.type === 'comm_link' || r.type === 'stage') && r.id !== vs.relayId)
      .sort((a, b) => a.position - b.position);
    if (rooms.length) items.push({ label: 'Move To', children: rooms.map((r) => ({ label: r.name, onClick: () => void moderate(beaconId, userId, { relayId: r.id }) })) });
    items.push({ label: 'Disconnect', danger: true, onClick: () => void moderate(beaconId, userId, { relayId: null }) });
  }
  return items;
}

/** VOICE_MODERATION: a moderator acted on me. */
export function onVoiceModeration(d: { beaconId: string; serverMuted: boolean; serverDeafened: boolean; moveTo?: string | null; moveToName?: string | null }) {
  const me = getState().me?.id;
  const member = me ? getState().members[d.beaconId]?.[me] : undefined;
  if (member) {
    setState((s) => ({ members: { ...s.members, [d.beaconId]: { ...s.members[d.beaconId], [me!]: { ...member, serverMuted: d.serverMuted, serverDeafened: d.serverDeafened } } } }));
  }
  if (d.moveTo === undefined) return;
  if (d.moveTo === null) {
    void leaveVoice();
    toast('A moderator disconnected you from voice.', 'warning');
  } else {
    void joinVoice(d.moveTo, d.beaconId);
    toast(`A moderator moved you to ${d.moveToName ?? 'another comm-link'}.`, 'warning');
  }
}

/** Mirror server mute and deafen for the beacon I am in now: my mic follows, and stays down. */
function sync() {
  const { beaconId, relayId } = useVoice.getState();
  const me = getState().me?.id;
  const member = beaconId && relayId && me ? getState().members[beaconId]?.[me] : undefined;
  const serverMuted = !!member?.serverMuted;
  const serverDeafened = !!member?.serverDeafened;
  const prefs = useAudioPrefs.getState();
  if (prefs.serverMuted === serverMuted && prefs.serverDeafened === serverDeafened) return;
  useAudioPrefs.setState({
    serverMuted,
    serverDeafened,
    ...(serverMuted || serverDeafened ? { muted: true } : {}),
    ...(serverDeafened ? { deafened: true } : {}),
  });
}
useStore.subscribe(sync);
useVoice.subscribe(sync);

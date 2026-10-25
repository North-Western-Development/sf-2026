import type { ContextMenuItem } from '@subspace/ui';
import { getState, setState } from '../../data/store';
import { ackChannel } from '../../data/actions';
import { channelIndicator } from '../../data/selectors';
import { relayPermissions, beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { isMuted, settingFor } from '../../data/notifications';
import { muteDurations, setNotificationSetting } from '../../data/notificationActions';
import { channelKey, type NotificationLevel } from '../../lib/types';
import { http } from '../../lib/http';
import { confirmAction, openModal, promptText, toast } from '../../app/ui';
import { term } from '../../lib/strings';
import { copyText } from '../../lib/clipboard';

const LEVELS: Array<{ level: NotificationLevel; label: string }> = [
  { level: 'inherit', label: 'Use Default' },
  { level: 'all', label: 'All Transmissions' },
  { level: 'mentions', label: 'Only @mentions' },
  { level: 'nothing', label: 'Nothing' },
];

function notificationItems(scope: 'relay' | 'category', id: string, label: string): ContextMenuItem[] {
  const s = getState();
  const setting = settingFor(s, scope, id);
  const muted = isMuted(setting);
  return [
    muted
      ? { label: `Unmute ${label}`, onClick: () => void setNotificationSetting(scope, id, { mutedUntil: null }) }
      : {
          label: `Mute ${label}`,
          children: muteDurations().map((d) => ({ label: d.label, onClick: () => void setNotificationSetting(scope, id, { mutedUntil: d.until() }) })),
        },
    {
      label: 'Notification Settings',
      children: LEVELS.map((l) => ({
        label: l.label,
        checked: (setting?.level ?? 'inherit') === l.level,
        onClick: () => void setNotificationSetting(scope, id, { level: l.level }),
      })),
    },
  ];
}

export function relayMenu(relayId: string, navigate: (p: string) => void): ContextMenuItem[] {
  const s = getState();
  const relay = s.relays[relayId];
  if (!relay) return [];
  const key = channelKey('relay', relayId);
  const ind = channelIndicator(s, key);
  const perms = relayPermissions(s, relayId);
  const manage = can(perms, PERMISSIONS.MANAGE_RELAYS);

  const items: ContextMenuItem[] = [
    { label: 'Mark as Read', disabled: !ind.unread && !ind.mentions, onClick: () => void ackChannel(key) },
    { separator: true },
  ];
  if (can(perms, PERMISSIONS.CREATE_INVITES)) items.push({ label: 'Invite Transmitters', onClick: () => openModal({ kind: 'invite', beaconId: relay.beaconId, relayId }) });
  items.push({
    label: 'Copy Link',
    onClick: () => {
      void copyText(`${window.location.origin}/channels/${relay.beaconId}/${relayId}`, 'Link copied');
    },
  });
  items.push({ separator: true }, ...notificationItems('relay', relayId, term('relay')));
  if (!relay.isUnhideable) {
    items.push({
      label: `Hide ${term('relay')}`,
      onClick: async () => {
        setState((st) => ({ relays: { ...st.relays, [relayId]: { ...relay, isHidden: true } } }));
        await http.patch(`/beacons/${relay.beaconId}/relays/${relayId}/visibility`, { isHidden: true }).catch(() => toast('Could not hide relay', 'error'));
        if (window.location.pathname.includes(relayId)) navigate(`/channels/${relay.beaconId}`);
      },
    });
  }
  if (manage) {
    items.push(
      { separator: true },
      { label: `Edit ${term('relay')}`, onClick: () => openModal({ kind: 'beaconSettings', beaconId: relay.beaconId, tab: `relay:${relayId}` }) },
      {
        label: `Delete ${term('relay')}`,
        danger: true,
        onClick: () =>
          confirmAction({
            title: `Delete ${term('relay')}`,
            body: `Are you sure you want to delete #${relay.name}? This cannot be undone.`,
            confirmLabel: `Delete ${term('relay')}`,
            danger: true,
            onConfirm: async () => {
              await http.delete(`/beacons/${relay.beaconId}/relays/${relayId}`);
              setState((st) => ({
                relayIdsByBeacon: { ...st.relayIdsByBeacon, [relay.beaconId]: (st.relayIdsByBeacon[relay.beaconId] ?? []).filter((x) => x !== relayId) },
              }));
              navigate(`/channels/${relay.beaconId}`);
            },
          }),
      }
    );
  }
  items.push({ separator: true }, { label: `Copy ${term('relay')} ID`, onClick: () => void copyText(relayId) });
  return items;
}

export function bandMenu(bandId: string, collapsed: boolean, toggle: () => void): ContextMenuItem[] {
  const s = getState();
  const band = s.relays[bandId];
  if (!band) return [];
  const children = (s.relayIdsByBeacon[band.beaconId] ?? []).filter((id) => s.relays[id]?.parentId === bandId);
  const anyUnread = children.some((id) => {
    const i = channelIndicator(s, channelKey('relay', id));
    return i.unread || i.mentions;
  });
  const manage = can(beaconPermissions(s, band.beaconId), PERMISSIONS.MANAGE_RELAYS);
  const items: ContextMenuItem[] = [
    { label: 'Mark as Read', disabled: !anyUnread, onClick: () => children.forEach((id) => void ackChannel(channelKey('relay', id))) },
    { separator: true },
    { label: collapsed ? `Expand ${term('band')}` : `Collapse ${term('band')}`, onClick: toggle },
    { separator: true },
    ...notificationItems('category', bandId, term('band')),
  ];
  if (manage) {
    items.push(
      { separator: true },
      {
        label: `Rename ${term('band')}`,
        onClick: () =>
          promptText({
            title: `Rename ${term('band')}`,
            label: `${term('band')} name`,
            initial: band.name,
            maxLength: 100,
            onSubmit: async (name) => {
              await http.patch(`/beacons/${band.beaconId}/relays/${bandId}`, { name });
              setState((st) => ({ relays: { ...st.relays, [bandId]: { ...band, name } } }));
            },
          }),
      },
      {
        label: `Delete ${term('band')}`,
        danger: true,
        onClick: () =>
          confirmAction({
            title: `Delete ${term('band')}`,
            body: `Delete ${band.name}? Relays inside it will move out of the band.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: async () => {
              await http.delete(`/beacons/${band.beaconId}/relays/${bandId}`);
              setState((st) => ({
                relayIdsByBeacon: { ...st.relayIdsByBeacon, [band.beaconId]: (st.relayIdsByBeacon[band.beaconId] ?? []).filter((x) => x !== bandId) },
              }));
            },
          }),
      }
    );
  }
  items.push({ separator: true }, { label: `Copy ${term('band')} ID`, onClick: () => void copyText(bandId) });
  return items;
}

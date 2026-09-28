import type { ContextMenuItem } from '@subspace/ui';
import { getState } from '../../data/store';
import { ackBeacon, leaveBeacon } from '../../data/actions';
import { beaconIndicator } from '../../data/selectors';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { isMuted, settingFor } from '../../data/notifications';
import { setNotificationSetting, muteDurations } from '../../data/notificationActions';
import { confirmAction, openModal, toast } from '../../app/ui';
import { term } from '../../lib/strings';

/** Right-click / header-dropdown menu for a beacon (Discord's server menu). */
export function beaconMenu(beaconId: string, navigate: (path: string) => void, opts: { header?: boolean } = {}): ContextMenuItem[] {
  const s = getState();
  const beacon = s.beacons[beaconId];
  if (!beacon) return [];
  const perms = beaconPermissions(s, beaconId);
  const isOwner = beacon.ownerId === s.me?.id;
  const ind = beaconIndicator(s, beaconId);
  const muted = isMuted(settingFor(s, 'beacon', beaconId));

  const items: ContextMenuItem[] = [];
  if (!opts.header) {
    items.push({ label: 'Mark as Read', disabled: !ind.unread && !ind.mentions, onClick: () => void ackBeacon(beaconId) }, { separator: true });
  }
  if (can(perms, PERMISSIONS.CREATE_INVITES)) {
    items.push({ label: 'Invite Transmitters', onClick: () => openModal({ kind: 'invite', beaconId }) });
  }
  if (can(perms, PERMISSIONS.MANAGE_BEACON) || can(perms, PERMISSIONS.MANAGE_RELAYS) || can(perms, PERMISSIONS.MANAGE_CLEARANCES)) {
    items.push({ label: `${term('beacon')} Settings`, onClick: () => openModal({ kind: 'beaconSettings', beaconId }) });
  }
  if (can(perms, PERMISSIONS.MANAGE_RELAYS)) {
    items.push(
      { label: `Create ${term('relay')}`, onClick: () => openModal({ kind: 'createRelay', beaconId }) },
      { label: `Create ${term('band')}`, onClick: () => openModal({ kind: 'createBand', beaconId }) }
    );
  }
  items.push({ separator: true });
  items.push(
    muted
      ? { label: `Unmute ${term('beacon')}`, onClick: () => void setNotificationSetting('beacon', beaconId, { mutedUntil: null }) }
      : {
          label: `Mute ${term('beacon')}`,
          children: muteDurations().map((d) => ({
            label: d.label,
            onClick: () => void setNotificationSetting('beacon', beaconId, { mutedUntil: d.until() }),
          })),
        },
    { label: 'Notification Settings', onClick: () => openModal({ kind: 'notificationSettings', beaconId }) },
    { separator: true },
    { label: 'Edit Beacon Profile', onClick: () => openModal({ kind: 'userSettings', tab: `beacon-profile:${beaconId}` }) }
  );
  if (!isOwner) {
    items.push(
      { separator: true },
      {
        label: `Leave ${term('beacon')}`,
        danger: true,
        onClick: () =>
          confirmAction({
            title: `Leave '${beacon.name}'`,
            body: `Are you sure you want to leave ${beacon.name}? You won't be able to rejoin unless you are re-invited.`,
            confirmLabel: `Leave ${term('beacon')}`,
            danger: true,
            onConfirm: async () => {
              await leaveBeacon(beaconId);
              navigate('/channels/@me');
            },
          }),
      },
      {
        label: `Report ${term('beacon')}`,
        danger: true,
        onClick: () => openModal({ kind: 'report', targetType: 'beacon', targetId: beaconId }),
      }
    );
  }
  items.push(
    { separator: true },
    {
      label: 'Copy Beacon ID',
      onClick: () => {
        void navigator.clipboard?.writeText(beaconId);
        toast('Beacon ID copied');
      },
    }
  );
  return items;
}

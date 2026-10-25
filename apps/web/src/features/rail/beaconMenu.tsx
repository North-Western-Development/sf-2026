import type { ContextMenuItem } from '@subspace/ui';
import { getState } from '../../data/store';
import { ackBeacon, leaveBeacon } from '../../data/actions';
import { beaconIndicator } from '../../data/selectors';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { isMuted, settingFor } from '../../data/notifications';
import { setNotificationSetting, muteDurations } from '../../data/notificationActions';
import { confirmAction, openModal, toast } from '../../app/ui';
import { term } from '../../lib/strings';
import { copyText } from '../../lib/clipboard';
import { addToCluster } from './railOrder';

const soon = (label: string): ContextMenuItem => ({ label, disabled: true, sublabel: 'Coming soon' });

/** Right-click / header-dropdown menu for a beacon (Discord's server menu). */
export function beaconMenu(beaconId: string, navigate: (path: string) => void, opts: { header?: boolean } = {}): ContextMenuItem[] {
  const s = getState();
  const beacon = s.beacons[beaconId];
  if (!beacon) return [];
  const perms = beaconPermissions(s, beaconId);
  const isOwner = beacon.ownerId === s.me?.id;
  const ind = beaconIndicator(s, beaconId);
  const muted = isMuted(settingFor(s, 'beacon', beaconId));
  const manageBeacon = can(perms, PERMISSIONS.MANAGE_BEACON);
  const manageRelays = can(perms, PERMISSIONS.MANAGE_RELAYS);
  const settings = (tab: string) => () => openModal({ kind: 'beaconSettings', beaconId, tab });

  const items: ContextMenuItem[] = [];
  if (!opts.header) {
    items.push({ label: 'Mark As Read', disabled: !ind.unread && !ind.mentions, onClick: () => void ackBeacon(beaconId) }, { separator: true });
  }
  if (can(perms, PERMISSIONS.CREATE_INVITES)) {
    items.push({ label: `Invite to ${term('beacon')}`, onClick: () => openModal({ kind: 'invite', beaconId }) }, { separator: true });
  }
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
    { separator: true }
  );

  // Server Settings: each page directly, like Discord's submenu (only the ones this member can open).
  const pages: ContextMenuItem[] = [
    ...(manageBeacon ? [{ label: `${term('beacon')} Profile`, onClick: settings('overview') }] : []),
    soon(`${term('beacon')} Tag`),
    ...(manageBeacon ? [{ label: 'Engagement', onClick: settings('engagement') }] : []),
    ...(can(perms, PERMISSIONS.MANAGE_GLYPHS) ? [{ label: term('glyph', true), onClick: settings('glyphs') }] : []),
    soon('Stickers'),
    soon('Soundboard'),
    { label: 'Members', onClick: () => navigate(`/channels/${beaconId}/member-safety`) },
    ...(can(perms, PERMISSIONS.MANAGE_CLEARANCES) ? [{ label: term('clearance', true), onClick: settings('clearances') }] : []),
    ...(can(perms, PERMISSIONS.CREATE_INVITES) ? [{ label: 'Invites', onClick: settings('invites') }] : []),
    ...(manageRelays ? [{ label: term('relay', true), onClick: settings('relays') }] : []),
    ...(manageBeacon ? [{ label: 'Onboarding', onClick: settings('onboarding') }] : []),
    ...(manageBeacon ? [{ label: 'Safety Setup', onClick: settings('safety') }, { label: 'AutoMod', onClick: settings('automod') }] : []),
    ...(can(perms, PERMISSIONS.VIEW_AUDIT_LOG) ? [{ label: 'Audit Log', onClick: settings('audit') }] : []),
    ...(can(perms, PERMISSIONS.BAN_MEMBERS) ? [{ label: 'Bans', onClick: settings('bans') }] : []),
  ];
  if (manageBeacon || manageRelays || can(perms, PERMISSIONS.MANAGE_CLEARANCES) || can(perms, PERMISSIONS.VIEW_AUDIT_LOG)) {
    // The header dropdown opens settings itself, as Discord's does; the right-click menu lists pages.
    items.push(
      opts.header
        ? { label: `${term('beacon')} Settings`, onClick: () => openModal({ kind: 'beaconSettings', beaconId }) }
        : { label: `${term('beacon')} Settings`, children: pages }
    );
  }
  items.push(
    { label: 'Privacy Settings', onClick: () => openModal({ kind: 'beaconPrivacy', beaconId }) },
    { label: `Edit Per-${term('beacon').toLowerCase()} Profile`, onClick: () => openModal({ kind: 'userSettings', tab: `beacon-profile:${beaconId}` }) }
  );

  const create: ContextMenuItem[] = [];
  if (manageRelays) {
    create.push(
      { label: `Create ${term('relay')}`, onClick: () => openModal({ kind: 'createRelay', beaconId }) },
      { label: `Create ${term('band')}`, onClick: () => openModal({ kind: 'createBand', beaconId }) }
    );
  }
  if (can(perms, PERMISSIONS.CREATE_EVENTS)) create.push({ label: 'Create Event', onClick: () => openModal({ kind: 'createEvent', beaconId }) });
  if (create.length) items.push({ separator: true }, ...create);

  // Move to…: into another cluster, or to either end of its own (Discord's server folders).
  if (!opts.header) {
    const own = s.clusters.find((c) => c.beaconIds.includes(beaconId));
    const others = s.clusters.filter((c) => c !== own);
    const move = (clusterId: string, index?: number) => () => void addToCluster(clusterId, beaconId, index).catch(() => toast(`Could not move the ${term('beacon').toLowerCase()}`, 'error'));
    const moves: ContextMenuItem[] = [
      { label: 'Cluster', disabled: !others.length, children: others.map((c) => ({ label: c.name, onClick: move(c.id) })) },
    ];
    if (own) {
      moves.push(
        { separator: true },
        { label: 'First in Cluster', disabled: own.beaconIds[0] === beaconId, onClick: move(own.id, 0) },
        { label: 'Last in Cluster', disabled: own.beaconIds.at(-1) === beaconId, onClick: move(own.id) }
      );
    }
    items.push({ separator: true }, { label: 'Move to…', disabled: !others.length && !own, children: moves });
  }

  if (manageBeacon) items.push({ separator: true }, { label: 'Security Actions', danger: true, onClick: settings('safety') });

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
      label: `Copy ${term('beacon')} Info`,
      children: [
        { label: `Copy ${term('beacon')} Name`, onClick: () => void copyText(beacon.name, 'Name copied') },
        { label: `Copy ${term('beacon')} Link`, onClick: () => void copyText(`${window.location.origin}/channels/${beaconId}`, 'Link copied') },
        { label: `Copy ${term('beacon')} ID`, onClick: () => void copyText(beaconId, `${term('beacon')} ID copied`) },
      ],
    }
  );
  return items;
}

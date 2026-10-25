import type { ContextMenuItem } from '@subspace/ui';
import { getState } from '../../data/store';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { blockUser, openDirectLink, removeRelationship } from '../../data/actions';
import { http } from '../../lib/http';
import { userTag } from '../../lib/normalize';
import { confirmAction, openModal, promptText, toast } from '../../app/ui';
import { channelKey } from '../../lib/types';
import { joinCall } from '../voice/session';
import { copyText } from '../../lib/clipboard';

/** Context menu for a transmitter (member list, author lines, DM rows). */
export function memberMenu(beaconId: string | undefined, userId: string, navigate?: (p: string) => void): ContextMenuItem[] {
  const s = getState();
  const user = s.users[userId];
  const me = s.me;
  if (!user || !me) return [];
  const self = userId === me.id;
  const rel = s.relationships[userId];
  const items: ContextMenuItem[] = [{ label: 'Profile', onClick: () => openModal({ kind: 'profile', userId, beaconId }) }];

  if (!self) {
    items.push({
      label: 'Message',
      onClick: async () => {
        try {
          const linkId = await openDirectLink(userId);
          (navigate ?? ((p: string) => window.history.pushState({}, '', p)))(`/channels/@me/${linkId}`);
        } catch {
          toast('You cannot open a Direct Link with this transmitter.', 'error');
        }
      },
    });
    items.push({
      label: 'Call',
      onClick: async () => {
        try {
          const linkId = await openDirectLink(userId);
          (navigate ?? ((p: string) => window.history.pushState({}, '', p)))(`/channels/@me/${linkId}`);
          void joinCall(channelKey('link', linkId));
        } catch {
          toast('You cannot call this transmitter.', 'error');
        }
      },
    });
  }
  items.push({
    label: 'Add Note',
    onClick: () =>
      promptText({
        title: `Note for ${userTag(user)}`,
        label: 'Only you can see this note',
        maxLength: 256,
        onSubmit: (note) => http.put(`/users/${userId}/note`, { note }).then(() => toast('Note saved')),
      }),
  });

  if (beaconId) {
    const perms = beaconPermissions(s, beaconId);
    const mod: ContextMenuItem[] = [];
    if (self ? can(perms, PERMISSIONS.CHANGE_NICKNAME) : can(perms, PERMISSIONS.MANAGE_NICKNAMES)) {
      mod.push({
        label: self ? 'Edit Beacon Profile' : 'Change Nickname',
        onClick: () =>
          self
            ? openModal({ kind: 'userSettings', tab: `beacon-profile:${beaconId}` })
            : promptText({
                title: 'Change Nickname',
                label: 'Nickname',
                initial: s.members[beaconId]?.[userId]?.nickname ?? '',
                maxLength: 32,
                onSubmit: (nickname) => http.patch(`/beacons/${beaconId}/members/${userId}`, { nickname: nickname || null }),
              }),
      });
    }
    if (!self && can(perms, PERMISSIONS.MANAGE_CLEARANCES)) {
      const member = s.members[beaconId]?.[userId];
      const assignable = (s.clearances[beaconId] ?? []).filter((c) => c.position > 0).sort((a, b) => b.position - a.position);
      if (member && assignable.length) {
        mod.push({
          label: 'Clearances',
          children: assignable.map((c) => ({
            label: c.name,
            icon: <span className="block h-3 w-3 rounded-full" style={{ background: c.color }} />,
            checked: member.clearanceIds.includes(c.id),
            onClick: async () => {
              const next = member.clearanceIds.includes(c.id) ? member.clearanceIds.filter((x) => x !== c.id) : [...member.clearanceIds, c.id];
              await http
                .patch(`/beacons/${beaconId}/members/${userId}`, { clearanceIds: next })
                .catch(() => http.post(`/beacons/${beaconId}/clearances/members/${userId}/assign`, { clearanceIds: next }))
                .catch(() => toast('You cannot change clearances for this transmitter.', 'error'));
            },
          })),
        });
      }
    }
    if (!self && can(perms, PERMISSIONS.KICK_MEMBERS)) {
      mod.push({
        label: `Kick ${user.displayName || user.username}`,
        danger: true,
        onClick: () =>
          confirmAction({
            title: `Kick '${user.displayName || user.username}'`,
            body: 'They can rejoin with a new invite.',
            confirmLabel: 'Kick',
            danger: true,
            onConfirm: () => http.post(`/beacons/${beaconId}/members/${userId}/kick`),
          }),
      });
    }
    if (!self && can(perms, PERMISSIONS.BAN_MEMBERS)) {
      mod.push({
        label: `Ban ${user.displayName || user.username}`,
        danger: true,
        onClick: () =>
          confirmAction({
            title: `Ban '${user.displayName || user.username}'`,
            body: 'They will be removed and cannot rejoin until unbanned.',
            confirmLabel: 'Ban',
            danger: true,
            onConfirm: () => http.put(`/beacons/${beaconId}/bans/${userId}`, {}),
          }),
      });
    }
    if (mod.length) items.push({ separator: true }, ...mod);
  }

  if (!self) {
    items.push({ separator: true });
    if (rel?.type === 'friend') {
      items.push({
        label: 'Remove Affiliate',
        danger: true,
        onClick: () =>
          confirmAction({
            title: `Remove '${user.displayName || user.username}'`,
            body: 'Are you sure you want to remove them from your affiliates?',
            confirmLabel: 'Remove Affiliate',
            danger: true,
            onConfirm: () => removeRelationship(userId),
          }),
      });
    } else if (!rel) {
      items.push({
        label: 'Add Affiliate',
        onClick: () =>
          http
            .post('/affiliations/request', { targetId: userId })
            .then(() => toast('Affiliation request sent'))
            .catch((e) => toast(e.message, 'error')),
      });
    }
    items.push(
      rel?.type === 'blocked'
        ? { label: 'Unblock', onClick: () => void http.delete(`/blacklist/${userId}`) }
        : {
            label: 'Block',
            danger: true,
            onClick: () =>
              confirmAction({
                title: `Block ${userTag(user)}`,
                body: 'They will not be able to message you and their transmissions will be hidden.',
                confirmLabel: 'Block',
                danger: true,
                onConfirm: () => blockUser(userId),
              }),
          },
      { label: 'Report Transmitter', danger: true, onClick: () => openModal({ kind: 'report', targetType: 'transmitter', targetId: userId }) }
    );
  }
  items.push({ separator: true }, { label: 'Copy Transmitter ID', onClick: () => void copyText(userId) });
  return items;
}

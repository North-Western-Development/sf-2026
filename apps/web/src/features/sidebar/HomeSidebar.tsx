import { useMemo } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { clsx } from 'clsx';
import { Inbox, Plus, Users, X, HardDrive } from 'lucide-react';
import { Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore, setState } from '../../data/store';
import { channelIndicator } from '../../data/selectors';
import { ackChannel, blockUser } from '../../data/actions';
import { setNotificationSetting, muteDurations } from '../../data/notificationActions';
import { isMuted, settingFor } from '../../data/notifications';
import { channelKey, type DirectLink, type Mesh } from '../../lib/types';
import { userTag } from '../../lib/normalize';
import { term } from '../../lib/strings';
import { openModal, confirmAction } from '../../app/ui';
import { Avatar, MentionBadge } from '../common/Avatar';
import { http } from '../../lib/http';
import { joinCall } from '../voice/session';
import { copyText } from '../../lib/clipboard';

function NavItem({ to, icon, label, badge }: { to: string; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        clsx(
          'flex h-10 items-center gap-3 rounded-md px-2 text-[15px] font-medium',
          isActive ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {!!badge && <MentionBadge count={badge} />}
    </NavLink>
  );
}

type Conversation = { kind: 'link'; link: DirectLink } | { kind: 'mesh'; mesh: Mesh };

function ConversationRow({ conv }: { conv: Conversation }) {
  const navigate = useNavigate();
  const { dmId } = useParams();
  const { openContextMenu } = useContextMenu();
  const id = conv.kind === 'link' ? conv.link.id : conv.mesh.id;
  const key = channelKey(conv.kind, id);
  const ind = useStore(useShallow((s) => channelIndicator(s, key)));
  const customStatus = useStore((s) => (conv.kind === 'link' ? s.presence[conv.link.recipient.id]?.customStatus?.text : undefined));
  const active = dmId === id;

  const name =
    conv.kind === 'link'
      ? conv.link.recipient.displayName || conv.link.recipient.username
      : conv.mesh.name || conv.mesh.members.map((m) => m.displayName || m.username).join(', ');

  const hide = async () => {
    setState((s) => {
      if (conv.kind === 'link') {
        const links = { ...s.links };
        delete links[id];
        return { links };
      }
      return {};
    });
    if (active) navigate('/channels/@me');
    if (conv.kind === 'link') await http.delete(`/links/${id}`).catch(() => {});
  };

  const menu = (): ContextMenuItem[] => {
    const s = useStore.getState();
    const muted = isMuted(settingFor(s, conv.kind, id));
    const items: ContextMenuItem[] = [
      { label: 'Mark as Read', disabled: !ind.unread && !ind.mentions, onClick: () => void ackChannel(key) },
      { separator: true },
    ];
    if (conv.kind === 'link') {
      const u = conv.link.recipient;
      items.push(
        { label: 'Profile', onClick: () => openModal({ kind: 'profile', userId: u.id }) },
        {
          label: 'Call',
          onClick: () => {
            navigate(`/channels/@me/${id}`);
            void joinCall(key);
          },
        },
        { separator: true }
      );
      items.push(
        muted
          ? { label: `Unmute @${u.username}`, onClick: () => void setNotificationSetting('link', id, { mutedUntil: null }) }
          : {
              label: `Mute @${u.username}`,
              children: muteDurations().map((d) => ({ label: d.label, onClick: () => void setNotificationSetting('link', id, { mutedUntil: d.until() }) })),
            },
        { separator: true },
        {
          label: 'Block',
          danger: true,
          onClick: () =>
            confirmAction({
              title: `Block ${userTag(u)}`,
              body: 'They will not be able to message you, and their transmissions will be hidden.',
              confirmLabel: 'Block',
              danger: true,
              onConfirm: () => blockUser(u.id),
            }),
        },
        { label: 'Close Link', onClick: () => void hide() },
        { separator: true },
        { label: 'Copy Transmitter ID', onClick: () => void copyText(u.id) }
      );
    } else {
      items.push(
        muted
          ? { label: `Unmute ${term('mesh')}`, onClick: () => void setNotificationSetting('mesh', id, { mutedUntil: null }) }
          : {
              label: `Mute ${term('mesh')}`,
              children: muteDurations().map((d) => ({ label: d.label, onClick: () => void setNotificationSetting('mesh', id, { mutedUntil: d.until() }) })),
            },
        { separator: true },
        {
          label: `Leave ${term('mesh')}`,
          danger: true,
          onClick: () =>
            confirmAction({
              title: `Leave '${name}'`,
              body: 'You will not be able to rejoin unless a member adds you again.',
              confirmLabel: `Leave ${term('mesh')}`,
              danger: true,
              onConfirm: async () => {
                await http.delete(`/meshes/${id}/members/@me`);
                setState((s) => {
                  const meshes = { ...s.meshes };
                  delete meshes[id];
                  return { meshes };
                });
                if (active) navigate('/channels/@me');
              },
            }),
        },
        { separator: true },
        { label: `Copy ${term('mesh')} ID`, onClick: () => void copyText(id) }
      );
    }
    return items;
  };

  return (
    <div
      className={clsx(
        'group relative flex h-11 items-center gap-3 rounded-md px-2 cursor-pointer',
        active ? 'bg-active' : 'hover:bg-hover',
        ind.muted && !active && 'opacity-50'
      )}
      onClick={() => navigate(`/channels/@me/${id}`)}
      onContextMenu={(e) => openContextMenu(e, menu())}
      role="link"
      aria-current={active ? 'page' : undefined}
    >
      {conv.kind === 'link' ? (
        <Avatar user={conv.link.recipient} size={32} showPresence ring={active ? 'var(--color-active)' : 'var(--color-raised)'} />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-strong text-sm font-bold text-white">
          {conv.mesh.iconUrl ? <img src={conv.mesh.iconUrl} alt="" className="h-full w-full rounded-full object-cover" /> : <Users className="h-4 w-4" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-[15px]', active || ind.unread || ind.mentions ? 'font-semibold text-fg' : 'text-fg-muted group-hover:text-fg')}>
          {name}
        </span>
        {conv.kind === 'mesh' ? (
          <span className="block truncate text-xs text-fg-subtle">{conv.mesh.members.length} Members</span>
        ) : customStatus ? (
          <span className="block truncate text-xs text-fg-subtle">{customStatus}</span>
        ) : null}
      </span>
      <MentionBadge count={ind.mentions} />
      {conv.kind === 'link' && (
        <Tooltip content="Close Link">
          <button
            type="button"
            aria-label="Close Link"
            className="hidden h-5 w-5 items-center justify-center rounded-xs text-fg-subtle hover:text-fg group-hover:flex"
            onClick={(e) => {
              e.stopPropagation();
              void hide();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function HomeSidebar() {
  const { links, meshes, incoming, requests } = useStore(
    useShallow((s) => ({
      links: s.links,
      meshes: s.meshes,
      incoming: Object.values(s.relationships).filter((r) => r.type === 'incoming').length,
      requests: Object.keys(s.transmissionRequests).length,
    }))
  );
  const activity = useStore((s) => s.activity);

  const conversations = useMemo(() => {
    const list: Array<Conversation & { at: string }> = [
      ...Object.values(links).map((link) => ({ kind: 'link' as const, link, at: activity[channelKey('link', link.id)]?.lastAt ?? link.lastTransmissionAt ?? '' })),
      ...Object.values(meshes).map((mesh) => ({ kind: 'mesh' as const, mesh, at: activity[channelKey('mesh', mesh.id)]?.lastAt ?? mesh.lastTransmissionAt ?? '' })),
    ];
    return list.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [links, meshes, activity]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-line px-2.5 shadow-sm">
        <button
          type="button"
          onClick={() => openModal({ kind: 'quickScan' })}
          className="h-7 w-full rounded-sm bg-void px-2 text-left text-sm text-fg-subtle hover:text-fg-muted"
        >
          Find or start a conversation
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <NavItem to="/channels/@me" icon={<Users className="h-5 w-5" />} label={term('affiliate', true)} badge={incoming} />
        <NavItem to="/channels/@me/requests" icon={<Inbox className="h-5 w-5" />} label={term('transmissionRequest', true)} badge={requests} />
        <button
          type="button"
          onClick={() => openModal({ kind: 'vault' })}
          className="flex h-10 w-full items-center gap-3 rounded-md px-2 text-[15px] font-medium text-fg-muted hover:bg-hover hover:text-fg"
        >
          <HardDrive className="h-5 w-5" />
          {term('vault')}
        </button>

        <div className="mt-4 mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg-muted">{term('link', true)}</span>
          <Tooltip content={`Create ${term('mesh')}`}>
            <button type="button" aria-label={`Create ${term('mesh')}`} onClick={() => openModal({ kind: 'createMesh' })} className="text-fg-subtle hover:text-fg">
              <Plus className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
        <div className="space-y-0.5">
          {conversations.map((c) => (
            <ConversationRow key={c.kind === 'link' ? c.link.id : c.mesh.id} conv={c} />
          ))}
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-fg-subtle">No conversations yet. Say hi to an {term('affiliate').toLowerCase()}!</p>
          )}
        </div>
      </div>
    </div>
  );
}

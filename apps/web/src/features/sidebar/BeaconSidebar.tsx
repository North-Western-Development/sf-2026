import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { clsx } from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  Hash,
  Image as ImageIcon,
  MessagesSquare,
  Plus,
  Settings,
  UserPlus,
  Volume2,
  MicOff,
  HeadphoneOff,
  Lock,
} from 'lucide-react';
import { Tooltip, useContextMenu } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { channelIndicator } from '../../data/selectors';
import { loadBeacon } from '../../data/actions';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { channelKey, type Relay } from '../../lib/types';
import { openModal, useUi, rememberRelay } from '../../app/ui';
import { MentionBadge, Avatar } from '../common/Avatar';
import { beaconMenu } from '../rail/beaconMenu';
import { relayMenu, bandMenu } from './relayMenu';
import { relayKindLabel } from '../../lib/strings';

export function RelayIcon({ type, className = 'h-5 w-5', locked }: { type: Relay['type']; className?: string; locked?: boolean }) {
  const Icon = { text: Hash, comm_link: Volume2, archival: MessagesSquare, visual: ImageIcon, category: Hash }[type] ?? Hash;
  return (
    <span className="relative inline-flex shrink-0">
      <Icon className={className} aria-hidden="true" />
      {locked && <Lock className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5" aria-hidden="true" />}
    </span>
  );
}

function VoiceParticipants({ relayId, beaconId }: { relayId: string; beaconId: string }) {
  const participants = useStore(useShallow((s) => Object.values(s.voice).filter((v) => v.relayId === relayId)));
  const users = useStore((s) => s.users);
  const members = useStore((s) => s.members[beaconId]);
  if (!participants.length) return null;
  return (
    <ul className="ml-8 mb-1 space-y-0.5">
      {participants.map((p) => {
        const user = users[p.transmitterId] ?? { id: p.transmitterId, username: p.username, displayName: null, avatarUrl: null, discriminator: '0000' };
        const name = members?.[p.transmitterId]?.nickname || user.displayName || user.username;
        return (
          <li key={p.transmitterId} className="flex h-7 items-center gap-2 rounded-md px-1.5 text-sm text-fg-muted hover:bg-hover">
            <Avatar user={user} size={22} speaking={p.isSpeaking} />
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {p.isMuted && <MicOff className="h-3.5 w-3.5 text-fg-subtle" aria-label="Muted" />}
            {p.isDeafened && <HeadphoneOff className="h-3.5 w-3.5 text-fg-subtle" aria-label="Deafened" />}
          </li>
        );
      })}
    </ul>
  );
}

function RelayRow({ relay }: { relay: Relay }) {
  const navigate = useNavigate();
  const { relayId } = useParams();
  const { openContextMenu } = useContextMenu();
  const key = channelKey('relay', relay.id);
  const ind = useStore(useShallow((s) => channelIndicator(s, key)));
  const perms = useStore((s) => relayPermissions(s, relay.id));
  const active = relayId === relay.id;
  const showInvite = can(perms, PERMISSIONS.CREATE_INVITES);
  const showSettings = can(perms, PERMISSIONS.MANAGE_RELAYS);
  const highlighted = active || ind.unread || ind.mentions > 0;

  return (
    <div>
      <div
        role="link"
        tabIndex={0}
        aria-current={active ? 'page' : undefined}
        aria-label={`${relay.name} (${relayKindLabel(relay.type)})${ind.unread ? ', unread' : ''}${ind.mentions ? `, ${ind.mentions} mentions` : ''}`}
        onClick={() => navigate(`/channels/${relay.beaconId}/${relay.id}`)}
        onKeyDown={(e) => e.key === 'Enter' && navigate(`/channels/${relay.beaconId}/${relay.id}`)}
        onContextMenu={(e) => openContextMenu(e, relayMenu(relay.id, navigate))}
        className={clsx(
          'group relative mx-2 flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2',
          active ? 'bg-active text-fg' : highlighted ? 'text-fg hover:bg-hover' : 'text-fg-subtle hover:bg-hover hover:text-fg-muted',
          ind.muted && !active && 'opacity-45'
        )}
      >
        {ind.unread && !active && <span aria-hidden="true" className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-fg" />}
        <RelayIcon type={relay.type} className="h-5 w-5 opacity-70" />
        <span className={clsx('min-w-0 flex-1 truncate text-[15px]', highlighted && 'font-semibold')}>{relay.name}</span>
        <span className="flex items-center gap-1">
          {showInvite && (
            <Tooltip content="Create Invite">
              <button
                type="button"
                aria-label="Create Invite"
                className={clsx('text-fg-subtle hover:text-fg', active ? 'flex' : 'hidden group-hover:flex')}
                onClick={(e) => {
                  e.stopPropagation();
                  openModal({ kind: 'invite', beaconId: relay.beaconId, relayId: relay.id });
                }}
              >
                <UserPlus className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          {showSettings && (
            <Tooltip content="Edit Relay">
              <button
                type="button"
                aria-label="Edit Relay"
                className={clsx('text-fg-subtle hover:text-fg', active ? 'flex' : 'hidden group-hover:flex')}
                onClick={(e) => {
                  e.stopPropagation();
                  openModal({ kind: 'beaconSettings', beaconId: relay.beaconId, tab: `relay:${relay.id}` });
                }}
              >
                <Settings className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          <MentionBadge count={ind.mentions} />
        </span>
      </div>
      {relay.type === 'comm_link' && <VoiceParticipants relayId={relay.id} beaconId={relay.beaconId} />}
    </div>
  );
}

function Band({ band, relays }: { band: Relay; relays: Relay[] }) {
  const { relayId } = useParams();
  const collapsed = useUi((s) => !!s.collapsedBands[band.id]);
  const { openContextMenu } = useContextMenu();
  const canManage = useStore((s) => can(relayPermissions(s, band.id), PERMISSIONS.MANAGE_RELAYS));
  const toggle = () => useUi.setState((s) => ({ collapsedBands: { ...s.collapsedBands, [band.id]: !collapsed } }));
  // Primitive flags (unread or mentioned) keep the selector referentially stable.
  const attention = useStore(
    useShallow((s) =>
      relays.map((r) => {
        const i = channelIndicator(s, channelKey('relay', r.id));
        return i.unread || i.mentions > 0;
      })
    )
  );
  // Collapsed bands still show the active relay and anything unread (Discord behaviour).
  const visible = collapsed ? relays.filter((r, i) => r.id === relayId || attention[i]) : relays;

  return (
    <section className="mt-4">
      <div
        className="group mx-2 flex h-6 items-center pr-1"
        onContextMenu={(e) => openContextMenu(e, bandMenu(band.id, collapsed, toggle))}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-0.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg-muted"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span className="truncate">{band.name}</span>
        </button>
        {canManage && (
          <Tooltip content="Create Relay">
            <button
              type="button"
              aria-label={`Create relay in ${band.name}`}
              className="text-fg-subtle hover:text-fg"
              onClick={() => openModal({ kind: 'createRelay', beaconId: band.beaconId, parentId: band.id })}
            >
              <Plus className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-0.5 space-y-px">
        {visible.map((r) => (
          <RelayRow key={r.id} relay={r} />
        ))}
      </div>
    </section>
  );
}

export function BeaconSidebar() {
  const { beaconId = '', relayId } = useParams();
  const navigate = useNavigate();
  const beacon = useStore((s) => s.beacons[beaconId]);
  const relayIds = useStore((s) => s.relayIdsByBeacon[beaconId]);
  const relaysById = useStore((s) => s.relays);
  const { openContextMenu } = useContextMenu();
  const headerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (beacon && !relayIds) void loadBeacon(beaconId).catch(() => {});
  }, [beaconId, beacon, relayIds]);

  useEffect(() => {
    if (relayId) rememberRelay(beaconId, relayId);
  }, [beaconId, relayId]);

  const { loose, bands } = useMemo(() => {
    const all = (relayIds ?? []).map((id) => relaysById[id]).filter((r): r is Relay => !!r && !r.isHidden);
    const byPos = (a: Relay, b: Relay) => a.position - b.position || a.name.localeCompare(b.name);
    const bandList = all.filter((r) => r.type === 'category').sort(byPos);
    const bandIds = new Set(bandList.map((b) => b.id));
    return {
      loose: all.filter((r) => r.type !== 'category' && (!r.parentId || !bandIds.has(r.parentId))).sort(byPos),
      bands: bandList.map((band) => ({ band, relays: all.filter((r) => r.parentId === band.id && r.type !== 'category').sort(byPos) })),
    };
  }, [relayIds, relaysById]);

  if (!beacon) return null;

  return (
    <div className="flex h-full flex-col">
      <button
        ref={headerRef}
        type="button"
        onClick={() => {
          const r = headerRef.current!.getBoundingClientRect();
          openContextMenu({ clientX: r.left + 10, clientY: r.bottom + 4 }, beaconMenu(beaconId, navigate, { header: true }));
        }}
        className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-left font-semibold text-fg shadow-sm hover:bg-hover"
      >
        <span className="min-w-0 flex-1 truncate">{beacon.name}</span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>
      {beacon.bannerUrl && <img src={beacon.bannerUrl} alt="" className="h-24 w-full shrink-0 object-cover" />}
      <nav aria-label="Relays" className="min-h-0 flex-1 overflow-y-auto pb-4 pt-3">
        {!relayIds ? (
          <div className="space-y-2 px-4" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-hover" style={{ width: `${55 + ((i * 17) % 40)}%` }} />
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-px">
              {loose.map((r) => (
                <RelayRow key={r.id} relay={r} />
              ))}
            </div>
            {bands.map(({ band, relays }) => (
              <Band key={band.id} band={band} relays={relays} />
            ))}
          </>
        )}
      </nav>
    </div>
  );
}

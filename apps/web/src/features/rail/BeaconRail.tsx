import { useState, type DragEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { Compass, Folder, Plus } from 'lucide-react';
import { Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { beaconIndicator, homeMentions } from '../../data/selectors';
import { ackBeacon } from '../../data/actions';
import { openModal, toast, promptText, useUi, lastRelay } from '../../app/ui';
import { MentionBadge } from '../common/Avatar';
import { PixelStar } from '../auth/PixelStar';
import { beaconMenu } from './beaconMenu';
import {
  addToCluster,
  deleteCluster,
  groupBeacons,
  moveRailItem,
  railItems,
  railKey,
  ungroupBeacon,
  updateCluster,
  type RailItem,
} from './railOrder';
import type { Cluster } from '../../lib/types';

const DRAG_MIME = 'application/x-subspace-beacon';

/** Left-edge indicator: none, unread dot, hover, or selected bar. */
function Pill({ state }: { state: 'none' | 'unread' | 'hover' | 'active' }) {
  const h = { none: 0, unread: 8, hover: 20, active: 40 }[state];
  return (
    <span
      aria-hidden="true"
      className="absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-all duration-150"
      style={{ height: h, opacity: h ? 1 : 0 }}
    />
  );
}

function BeaconGlyph({ name, iconUrl, active, size = 48 }: { name: string; iconUrl: string | null; active: boolean; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={clsx(
        'flex items-center justify-center overflow-hidden font-semibold transition-all duration-150',
        active ? 'rounded-xl bg-brand text-on-brand' : 'rounded-[24px] bg-overlay text-fg group-hover:rounded-xl group-hover:bg-brand group-hover:text-on-brand'
      )}
      style={{ width: size, height: size, fontSize: size > 30 ? 14 : 9 }}
    >
      {iconUrl ? <img src={iconUrl} alt="" className="h-full w-full object-cover" draggable={false} /> : initials}
    </span>
  );
}

function BeaconButton({
  beaconId,
  onDropBeacon,
  inCluster,
}: {
  beaconId: string;
  onDropBeacon?: (dragged: string) => void;
  inCluster?: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const beacon = useStore((s) => s.beacons[beaconId]);
  const ind = useStore(useShallow((s) => beaconIndicator(s, beaconId)));
  const { openContextMenu } = useContextMenu();
  const [hover, setHover] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  if (!beacon) return null;
  const active = pathname.startsWith(`/channels/${beaconId}`);

  const go = () => {
    const last = lastRelay(beaconId);
    navigate(last ? `/channels/${beaconId}/${last}` : `/channels/${beaconId}`);
  };

  return (
    <div
      className="relative flex w-full justify-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Pill state={active ? 'active' : hover ? 'hover' : ind.unread ? 'unread' : 'none'} />
      <Tooltip placement="right" content={beacon.name}>
        <button
          type="button"
          aria-label={`${beacon.name}${ind.mentions ? `, ${ind.mentions} mentions` : ''}`}
          aria-current={active ? 'page' : undefined}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, beaconId);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!onDropBeacon || !e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            setDropTarget(true);
          }}
          onDragLeave={() => setDropTarget(false)}
          onDrop={(e) => {
            setDropTarget(false);
            const dragged = e.dataTransfer.getData(DRAG_MIME);
            if (dragged && dragged !== beaconId && onDropBeacon) {
              e.preventDefault();
              e.stopPropagation();
              onDropBeacon(dragged);
            }
          }}
          onClick={go}
          onContextMenu={(e) => openContextMenu(e, beaconMenu(beaconId, navigate))}
          className={clsx('group relative rounded-[24px] outline-offset-4', dropTarget && 'ring-2 ring-brand-sky ring-offset-2 ring-offset-void rounded-xl')}
        >
          <BeaconGlyph name={beacon.name} iconUrl={beacon.iconUrl} active={active} size={inCluster ? 40 : 48} />
          <span className="absolute -bottom-1 -right-1">
            <MentionBadge count={ind.mentions} className="ring-4 ring-void" />
          </span>
        </button>
      </Tooltip>
    </div>
  );
}

function ClusterEntry({ cluster }: { cluster: Cluster }) {
  const open = useUi((s) => !!s.openClusters[cluster.id]);
  const { pathname } = useLocation();
  const beacons = useStore((s) => s.beacons);
  const agg = useStore(
    useShallow((s) => {
      let unread = false;
      let mentions = 0;
      for (const id of cluster.beaconIds) {
        const i = beaconIndicator(s, id);
        unread ||= i.unread;
        mentions += i.mentions;
      }
      return { unread, mentions };
    })
  );
  const { openContextMenu } = useContextMenu();
  const [hover, setHover] = useState(false);
  const containsActive = cluster.beaconIds.some((id) => pathname.startsWith(`/channels/${id}`));
  const toggle = () => useUi.setState((s) => ({ openClusters: { ...s.openClusters, [cluster.id]: !open } }));

  const menu: ContextMenuItem[] = [
    { label: 'Mark Cluster as Read', disabled: !agg.unread && !agg.mentions, onClick: () => cluster.beaconIds.forEach((id) => void ackBeacon(id)) },
    { separator: true },
    {
      label: 'Rename Cluster',
      onClick: () =>
        promptText({
          title: 'Rename Cluster',
          label: 'Cluster name',
          initial: cluster.name,
          maxLength: 32,
          onSubmit: (name) => updateCluster(cluster.id, { name }),
        }),
    },
    {
      label: 'Cluster Color',
      children: ['#3B8EF2', '#3DCBFF', '#FFF36B', '#3DDC84', '#FF9F43', '#FF4D6A', '#A78BFA', '#5A5C8E'].map((color) => ({
        label: color,
        checked: cluster.color.toUpperCase() === color,
        icon: <span className="block h-3 w-3 rounded-full" style={{ background: color }} />,
        onClick: () => void updateCluster(cluster.id, { color }),
      })),
    },
    { separator: true },
    { label: 'Ungroup Cluster', danger: true, onClick: () => void deleteCluster(cluster.id) },
  ];

  return (
    <div
      className={clsx('flex w-full flex-col items-center', open && 'rounded-2xl pb-1')}
      style={open ? { backgroundColor: `${cluster.color}1f` } : undefined}
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG_MIME) && e.preventDefault()}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData(DRAG_MIME);
        if (dragged) {
          e.preventDefault();
          void addToCluster(cluster.id, dragged).catch(() => toast('Could not update cluster', 'error'));
        }
      }}
    >
      <div className="relative flex w-full justify-center" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {!open && <Pill state={containsActive ? 'active' : hover ? 'hover' : agg.unread ? 'unread' : 'none'} />}
        <Tooltip placement="right" content={cluster.name}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${cluster.name} cluster`}
            onClick={toggle}
            onContextMenu={(e) => openContextMenu(e, menu)}
            className="relative flex h-12 w-12 items-center justify-center rounded-xl transition-colors"
            style={{ backgroundColor: open ? 'transparent' : `${cluster.color}33` }}
          >
            {open ? (
              <Folder className="h-5 w-5" style={{ color: cluster.color }} fill={cluster.color} />
            ) : (
              <span className="grid grid-cols-2 gap-0.5 p-1">
                {cluster.beaconIds.slice(0, 4).map((id) => {
                  const b = beacons[id];
                  return b ? (
                    <span key={id} className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-[5px] bg-overlay text-[7px] font-bold">
                      {b.iconUrl ? <img src={b.iconUrl} alt="" className="h-full w-full object-cover" /> : b.name[0]?.toUpperCase()}
                    </span>
                  ) : null;
                })}
              </span>
            )}
            {!open && (
              <span className="absolute -bottom-1 -right-1">
                <MentionBadge count={agg.mentions} className="ring-4 ring-void" />
              </span>
            )}
          </button>
        </Tooltip>
      </div>
      {open && (
        <div className="mt-2 flex w-full flex-col items-center gap-2">
          {cluster.beaconIds.map((id) => (
            <BeaconButton key={id} beaconId={id} inCluster />
          ))}
        </div>
      )}
    </div>
  );
}

/** Thin drop zone between rail entries for reordering. */
function Gap({ index, items }: { index: number; items: RailItem[] }) {
  const [over, setOver] = useState(false);
  const accept = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_MIME);
  return (
    <div
      className="relative h-2 w-full"
      onDragOver={(e) => {
        if (!accept(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const dragged = e.dataTransfer.getData(DRAG_MIME);
        if (!dragged) return;
        e.preventDefault();
        const clustered = useStore.getState().clusters.some((c) => c.beaconIds.includes(dragged));
        if (clustered) void ungroupBeacon(dragged, items, index);
        else moveRailItem(items, `beacon:${dragged}`, index);
      }}
    >
      {over && <span className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-brand-sky" />}
    </div>
  );
}

export function BeaconRail() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { beaconOrder, clusters } = useStore(useShallow((s) => ({ beaconOrder: s.beaconOrder, clusters: s.clusters })));
  const mentions = useStore(homeMentions);
  const [homeHover, setHomeHover] = useState(false);
  const items = railItems(beaconOrder, clusters);
  const atHome = pathname.startsWith('/channels/@me');

  return (
    <nav aria-label={`${'Beacons'}`} className="flex w-[72px] shrink-0 flex-col items-center overflow-y-auto overflow-x-hidden py-3 [scrollbar-width:none]">
      <div className="relative flex w-full justify-center" onMouseEnter={() => setHomeHover(true)} onMouseLeave={() => setHomeHover(false)}>
        <Pill state={atHome ? 'active' : homeHover ? 'hover' : 'none'} />
        <Tooltip placement="right" content="Direct Links">
          <button
            type="button"
            aria-label="Direct Links"
            onClick={() => navigate('/channels/@me')}
            className={clsx(
              'group relative flex h-12 w-12 items-center justify-center transition-all duration-150',
              atHome ? 'rounded-xl bg-brand' : 'rounded-[24px] bg-overlay hover:rounded-xl hover:bg-brand'
            )}
          >
            <PixelStar size={28} />
            <span className="absolute -bottom-1 -right-1">
              <MentionBadge count={mentions} className="ring-4 ring-void" />
            </span>
          </button>
        </Tooltip>
      </div>

      <div className="mx-auto my-2 h-0.5 w-8 rounded-full bg-line-strong" />

      <div className="flex w-full flex-col items-center">
        {items.map((item, index) => (
          <div key={railKey(item)} className="flex w-full flex-col items-center">
            <Gap index={index} items={items} />
            {item.kind === 'beacon' ? (
              <BeaconButton
                beaconId={item.id}
                onDropBeacon={(dragged) =>
                  void groupBeacons(item.id, dragged, items).catch(() => toast('Could not create cluster', 'error'))
                }
              />
            ) : (
              <ClusterEntry cluster={item.cluster} />
            )}
          </div>
        ))}
        <Gap index={items.length} items={items} />
      </div>

      <RailAction label="Add a Beacon" onClick={() => openModal({ kind: 'createBeacon' })} icon={<Plus className="h-6 w-6" />} />
      <RailAction
        label="Discover Beacons"
        active={pathname.startsWith('/discover')}
        onClick={() => navigate('/discover')}
        icon={<Compass className="h-6 w-6" />}
      />
    </nav>
  );
}

function RailAction({ label, icon, onClick, active }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <div className="relative mt-2 flex w-full justify-center">
      <Pill state={active ? 'active' : 'none'} />
      <Tooltip placement="right" content={label}>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={clsx(
            'flex h-12 w-12 items-center justify-center transition-all duration-150',
            active ? 'rounded-xl bg-online text-void' : 'rounded-[24px] bg-overlay text-online hover:rounded-xl hover:bg-online hover:text-void'
          )}
        >
          {icon}
        </button>
      </Tooltip>
    </div>
  );
}


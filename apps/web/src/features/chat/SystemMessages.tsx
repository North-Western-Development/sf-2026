import { ArrowRight, Check, ImagePlus, MessageSquare, Megaphone, UserPlus } from 'lucide-react';
import { clsx } from 'clsx';
import { useStore } from '../../data/store';
import { sendMessage } from '../../data/actions';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { openModal } from '../../app/ui';
import { formatMessageTime } from '../../lib/time';
import { term } from '../../lib/strings';
import type { ChannelKey, Transmission } from '../../lib/types';
import { UserName } from '../common/UserName';
import { Emoji } from '../../lib/emoji';

/** Welcome lines (the server stores which one as the content): "{}" is the new member. */
export const WELCOME_LINES = [
  '{} just docked. Everyone, look busy!',
  'Signal acquired: {} has entered orbit.',
  'Welcome aboard, {}. Mind the airlock.',
  '{} warped in. Say hi!',
  'A new transmitter appears: {}.',
  '{} just tuned in to this frequency.',
  'Everyone welcome {}!',
  '{} hopped on board. Strap in!',
  'Incoming! {} has arrived.',
  'Good to see you, {}. Grab a seat by the viewport.',
  '{} just landed. Hope you brought snacks.',
  'Contact! {} joined the crew.',
  '{} slid into the beacon.',
];

export function JoinMessage({ m, channelKey, beaconId, onOpenProfile }: { m: Transmission; channelKey: ChannelKey; beaconId?: string; onOpenProfile: (e: React.MouseEvent) => void }) {
  const wave = useStore((s) => (beaconId ? s.beacons[beaconId]?.welcomeWave !== false : false));
  const isMine = useStore((s) => s.me?.id === m.author.id);
  const line = WELCOME_LINES[Number(m.content) % WELCOME_LINES.length] ?? WELCOME_LINES[0];
  const [before, after] = line.split('{}');
  return (
    <div id={`msg-${m.id}`} role="note" className="group flex items-start gap-4 py-1 pl-4 pr-12 text-[15px] text-fg-muted hover:bg-raised/60">
      <ArrowRight className="ml-3 mt-0.5 h-4 w-4 shrink-0 text-online" />
      <div className="min-w-0">
        <p>
          {before}
          <button className="font-semibold text-fg hover:underline" onClick={onOpenProfile}>
            <UserName user={m.author} beaconId={beaconId} styled={false} />
          </button>
          {after} <span className="text-xs text-fg-subtle">{formatMessageTime(m.createdAt)}</span>
        </p>
        {wave && !isMine && (
          <button
            type="button"
            onClick={() => void sendMessage(channelKey, '👋', { replyToId: m.id })}
            className="mt-2 flex items-center gap-2 rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-fg hover:bg-hover"
          >
            <Emoji emoji="👋" size={20} /> Wave to say hi!
          </button>
        )}
      </div>
    </div>
  );
}

/** The setup checklist a new beacon starts with (Discord's "helpful tips"). */
export function SetupTipsMessage({ m, beaconId }: { m: Transmission; beaconId?: string }) {
  const beacon = useStore((s) => (beaconId ? s.beacons[beaconId] : undefined));
  const perms = useStore((s) => (beaconId ? beaconPermissions(s, beaconId) : null));
  const memberCount = beacon?.memberCount ?? 1;
  if (!beacon || !beaconId) return null;
  const manage = !!perms && can(perms, PERMISSIONS.MANAGE_BEACON);
  const steps = [
    {
      label: `Invite your friends`,
      done: memberCount > 1,
      icon: <UserPlus />,
      onClick: perms !== null && can(perms, PERMISSIONS.CREATE_INVITES) ? () => openModal({ kind: 'invite', beaconId }) : undefined,
    },
    { label: `Personalize your ${term('beacon').toLowerCase()} with an icon`, done: !!beacon.iconUrl, icon: <ImagePlus />, onClick: manage ? () => openModal({ kind: 'beaconSettings', beaconId, tab: 'overview' }) : undefined },
    { label: 'Send your first transmission', done: false, icon: <MessageSquare />, onClick: () => document.querySelector<HTMLElement>('[role="textbox"][aria-label^="Transmit to"]')?.focus() },
    { label: 'Set up how members are welcomed', done: false, icon: <Megaphone />, onClick: manage ? () => openModal({ kind: 'beaconSettings', beaconId, tab: 'engagement' }) : undefined },
  ];
  return (
    <div id={`msg-${m.id}`} role="note" aria-label={`Welcome to ${beacon.name}`} className="mx-4 my-4 max-w-[520px] rounded-lg border border-line bg-raised p-4">
      <p className="text-lg font-bold text-fg">Welcome to {beacon.name}</p>
      <p className="mt-1 text-sm text-fg-muted">This is your brand new, shiny {term('beacon').toLowerCase()}. Here are some steps to help you get started.</p>
      <div className="mt-3 space-y-2">
        {steps.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={!s.onClick}
            onClick={s.onClick}
            className={clsx('flex w-full items-center gap-3 rounded-md bg-overlay px-3 py-2.5 text-left text-[15px] font-medium text-fg', s.onClick ? 'hover:bg-hover' : 'cursor-default')}
          >
            <span className={clsx('flex h-8 w-8 items-center justify-center rounded-full [&>svg]:h-4 [&>svg]:w-4', s.done ? 'bg-online text-void' : 'bg-brand-soft text-brand-sky')}>{s.done ? <Check /> : s.icon}</span>
            <span className={clsx(s.done && 'text-fg-muted line-through')}>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

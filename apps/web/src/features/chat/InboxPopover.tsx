import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { Check, Hash, Inbox } from 'lucide-react';
import { clsx } from 'clsx';
import { useStore } from '../../data/store';
import { ackChannel } from '../../data/actions';
import { channelIndicator } from '../../data/selectors';
import { http } from '../../lib/http';
import { toTransmission } from '../../lib/normalize';
import { channelKey, type Transmission } from '../../lib/types';
import { formatMessageTime } from '../../lib/time';
import { useUi } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown } from './markdown';
import { useMarkdownResolvers } from './resolvers';

interface Mention {
  transmission: Transmission;
  channel: { channelType: string; channelId: string; name?: string; beaconId?: string | null; beaconName?: string };
}

function MentionRow({ m, onJump }: { m: Mention; onJump: () => void }) {
  const resolvers = useMarkdownResolvers(m.channel.beaconId ?? undefined);
  const where = m.channel.channelType === 'relay' ? `#${m.channel.name} · ${m.channel.beaconName}` : 'Direct Link';
  return (
    <article className="rounded-lg border border-line bg-raised">
      <header className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs font-semibold text-fg-muted">
        <Hash className="h-3.5 w-3.5" /> <span className="min-w-0 flex-1 truncate">{where}</span>
        <button type="button" onClick={onJump} className="rounded-md bg-overlay px-2 py-0.5 text-fg hover:bg-hover">
          Jump
        </button>
      </header>
      <div className="flex gap-3 p-3">
        <Avatar user={m.transmission.author} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <UserName user={m.transmission.author} beaconId={m.channel.beaconId ?? undefined} className="font-medium" />{' '}
            <span className="text-xs text-fg-subtle">{formatMessageTime(m.transmission.createdAt)}</span>
          </p>
          <div className="text-sm text-fg">
            <Markdown content={m.transmission.content} resolvers={resolvers} />
          </div>
        </div>
      </div>
    </article>
  );
}

/** Discord's Inbox: transmissions that mention you, and relays with something unread. */
export function InboxPopover({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'mentions' | 'unreads'>('mentions');
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const s = useStore();
  const unreads = Object.values(s.relays)
    .filter((r) => r.type === 'text' && channelIndicator(s, channelKey('relay', r.id)).unread)
    .map((r) => ({ relay: r, beacon: s.beacons[r.beaconId], ind: channelIndicator(s, channelKey('relay', r.id)) }));

  const load = async (before?: string) => {
    const r = await http.get<{ mentions: Array<{ transmission: any; channel: Mention['channel'] }> }>(`/users/@me/mentions?limit=25${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    const page = r.mentions.map((m) => ({ ...m, transmission: toTransmission(m.transmission) }));
    setMentions((cur) => (before ? [...(cur ?? []), ...page] : page));
    setMore(page.length === 25);
  };
  useEffect(() => {
    void load().catch(() => setMentions([]));
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = (m: Mention) => {
    onClose();
    const key = channelKey(m.channel.channelType as any, m.channel.channelId);
    useUi.setState({ jumpTarget: { key, messageId: m.transmission.id } });
    if (m.channel.channelType === 'relay' && m.channel.beaconId) navigate(`/channels/${m.channel.beaconId}/${m.channel.channelId}`);
    else navigate(`/channels/@me/${m.channel.channelId}`);
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Inbox"
      className="fixed z-[1200] flex max-h-[75vh] w-[480px] flex-col overflow-hidden rounded-lg bg-overlay shadow-pop"
      style={{ top: anchor.bottom + 8, left: Math.max(8, anchor.right - 480) }}
    >
      <header className="border-b border-line px-4 pt-3">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Inbox className="h-5 w-5" /> Inbox
        </h2>
        <div role="tablist" className="flex gap-4">
          {(['mentions', 'unreads'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('border-b-2 pb-2 text-sm font-medium capitalize', tab === t ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg')}>
              {t}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {tab === 'mentions' && (
          <>
            {mentions === null && <p className="py-6 text-center text-sm text-fg-subtle">Loading…</p>}
            {mentions?.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">Nobody has mentioned you lately.</p>}
            {mentions?.map((m) => (
              <MentionRow key={m.transmission.id} m={m} onJump={() => jump(m)} />
            ))}
            {more && mentions && (
              <button type="button" className="w-full py-2 text-sm text-brand-sky hover:underline" onClick={() => void load(mentions.at(-1)!.transmission.createdAt)}>
                Load more
              </button>
            )}
          </>
        )}
        {tab === 'unreads' && (
          <>
            {unreads.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">You&apos;re all caught up.</p>}
            {unreads.map(({ relay, beacon, ind }) => (
              <div key={relay.id} className="flex items-center gap-3 rounded-lg bg-raised px-3 py-2">
                <Hash className="h-4 w-4 text-fg-subtle" />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    onClose();
                    navigate(`/channels/${relay.beaconId}/${relay.id}`);
                  }}
                >
                  <span className="block truncate font-medium text-fg">{relay.name}</span>
                  <span className="block truncate text-xs text-fg-subtle">
                    {beacon?.name}
                    {ind.mentions ? ` · ${ind.mentions} mention${ind.mentions === 1 ? '' : 's'}` : ''}
                  </span>
                </button>
                <button type="button" aria-label={`Mark ${relay.name} as read`} onClick={() => void ackChannel(channelKey('relay', relay.id))} className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg">
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}


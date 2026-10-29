import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { Check, MessageCircle, MoreVertical, Search, Users, X } from 'lucide-react';
import { Button, Tooltip, useContextMenu } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { openDirectLink, respondFriendRequest, removeRelationship, sendFriendRequest, unblockUser } from '../../data/actions';
import type { Relationship } from '../../lib/types';
import { userTag } from '../../lib/normalize';
import { PRESENCE_LABELS, term } from '../../lib/strings';
import { toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { memberMenu } from '../members/memberMenu';
import { PixelStar } from '../auth/PixelStar';
import { MobileNavButton } from '../../app/mobile';
import { ACTIVITY_VERBS } from '../activity/activity';
import { useActivityOf } from '../activity/ActivityViews';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

function Row({ rel }: { rel: Relationship }) {
  const navigate = useNavigate();
  const { openContextMenu } = useContextMenu();
  const presence = useStore((s) => s.presence[rel.user.id]);
  const status = presence?.status ?? 'offline';
  const activity = useActivityOf(rel.type === 'friend' ? rel.user.id : undefined);
  const sub =
    rel.type === 'incoming'
      ? `Incoming ${term('affiliationRequest')}`
      : rel.type === 'outgoing'
        ? `Outgoing ${term('affiliationRequest')}`
        : rel.type === 'blocked'
          ? 'Blocked'
          : presence?.customStatus?.text || (activity ? `${ACTIVITY_VERBS[activity.type]} ${activity.name}` : null) || PRESENCE_LABELS[status === 'invisible' ? 'offline' : status]?.label;

  const message = async () => {
    try {
      navigate(`/channels/@me/${await openDirectLink(rel.user.id)}`);
    } catch {
      toast('Could not open a Direct Link.', 'error');
    }
  };

  return (
    <div
      role="listitem"
      onClick={rel.type === 'friend' ? () => void message() : undefined}
      onContextMenu={(e) => openContextMenu(e, memberMenu(undefined, rel.user.id, navigate))}
      className="group mx-2 flex h-[62px] cursor-pointer items-center gap-3 rounded-md border-t border-line px-2 hover:rounded-md hover:border-transparent hover:bg-hover"
    >
      <Avatar user={rel.user} size={32} showPresence={rel.type === 'friend'} ring="var(--color-base)" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <span className="truncate font-semibold text-fg">{rel.user.displayName || rel.user.username}</span>
          <span className="hidden text-sm text-fg-muted group-hover:inline">{userTag(rel.user)}</span>
        </p>
        <p className="truncate text-sm text-fg-muted">{sub}</p>
        {rel.type === 'incoming' && rel.note && <p className="truncate text-xs italic text-fg-subtle">“{rel.note}”</p>}
      </div>
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        {rel.type === 'friend' && (
          <>
            <RoundAction label="Message" onClick={() => void message()}>
              <MessageCircle className="h-5 w-5" />
            </RoundAction>
            <RoundAction label="More" onClick={(e) => openContextMenu({ clientX: e.clientX, clientY: e.clientY }, memberMenu(undefined, rel.user.id, navigate))}>
              <MoreVertical className="h-5 w-5" />
            </RoundAction>
          </>
        )}
        {rel.type === 'incoming' && (
          <>
            <RoundAction label="Accept" tone="success" onClick={() => void respondFriendRequest(rel.id, true).catch(() => toast('Could not accept request', 'error'))}>
              <Check className="h-5 w-5" />
            </RoundAction>
            <RoundAction label="Ignore" tone="danger" onClick={() => void respondFriendRequest(rel.id, false).catch(() => toast('Could not decline request', 'error'))}>
              <X className="h-5 w-5" />
            </RoundAction>
          </>
        )}
        {rel.type === 'outgoing' && (
          <RoundAction label="Cancel" tone="danger" onClick={() => void removeRelationship(rel.user.id).catch(() => toast('Could not cancel request', 'error'))}>
            <X className="h-5 w-5" />
          </RoundAction>
        )}
        {rel.type === 'blocked' && (
          <RoundAction label="Unblock" tone="danger" onClick={() => void unblockUser(rel.user.id).catch(() => toast('Could not unblock', 'error'))}>
            <X className="h-5 w-5" />
          </RoundAction>
        )}
      </div>
    </div>
  );
}

function RoundAction({ label, onClick, tone, children }: { label: string; onClick: (e: React.MouseEvent) => void; tone?: 'success' | 'danger'; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={clsx(
          'flex h-9 w-9 items-center justify-center rounded-full bg-raised text-fg-muted',
          tone === 'success' ? 'hover:text-online' : tone === 'danger' ? 'hover:text-danger' : 'hover:text-fg'
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function AddAffiliate() {
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^[a-z0-9_.]{2,32}#\d{4}$/i.test(tag.trim());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await sendFriendRequest(tag.trim(), note.trim() || undefined);
      setState({ tone: 'ok', text: `Success! Your ${term('affiliationRequest').toLowerCase()} to ${tag.trim()} was sent.` });
      setTag('');
      setNote('');
    } catch (err) {
      setState({ tone: 'err', text: (err as Error).message || "Hm, didn't work. Double check the tag." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="border-b border-line px-8 py-5">
      <h2 className="font-bold uppercase text-fg">Add {term('affiliate')}</h2>
      <p className="mt-1 text-sm text-fg-muted">You can add {term('affiliate', true).toLowerCase()} with their Subspace tag, like name#0427.</p>
      <div className={clsx('mt-4 flex items-center rounded-lg border bg-void pr-2', state?.tone === 'err' ? 'border-danger' : state?.tone === 'ok' ? 'border-online' : 'border-line focus-within:border-brand')}>
        <input
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setState(null);
          }}
          placeholder="Enter a name#0000"
          aria-label="Transmitter tag"
          className="h-12 flex-1 bg-transparent px-3 text-fg outline-none placeholder:text-fg-subtle"
        />
        <Button type="submit" size="sm" disabled={!valid} isLoading={busy}>
          Send {term('affiliationRequest')}
        </Button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 200))}
        placeholder="Add an optional note (visible to them)"
        aria-label="Optional note"
        className="mt-2 h-9 w-full rounded-md border border-line bg-void px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-brand"
      />
      {state && <p className={clsx('mt-2 text-sm', state.tone === 'ok' ? 'text-online' : 'text-danger')}>{state.text}</p>}
    </form>
  );
}

export function FriendsView() {
  const [tab, setTab] = useState<Tab>('online');
  const [query, setQuery] = useState('');
  const relationships = useStore(useShallow((s) => Object.values(s.relationships)));
  const presence = useStore((s) => s.presence);
  const pendingCount = relationships.filter((r) => r.type === 'incoming').length;

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    const matches = (r: Relationship) => !q || r.user.username.includes(q) || (r.user.displayName ?? '').toLowerCase().includes(q);
    const byName = (a: Relationship, b: Relationship) => (a.user.displayName || a.user.username).localeCompare(b.user.displayName || b.user.username);
    const filtered = relationships.filter((r) => {
      if (tab === 'online') return r.type === 'friend' && !['offline', 'invisible', undefined].includes(presence[r.user.id]?.status);
      if (tab === 'all') return r.type === 'friend';
      if (tab === 'pending') return r.type === 'incoming' || r.type === 'outgoing';
      if (tab === 'blocked') return r.type === 'blocked';
      return false;
    });
    return filtered.filter(matches).sort(byName);
  }, [relationships, presence, tab, query]);

  const title = { online: 'Online', all: `All ${term('affiliate', true)}`, pending: 'Pending', blocked: 'Blocked', add: '' }[tab];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* On a phone the tabs get a row of their own under the title, all of them in view. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 shadow-sm md:h-12 md:flex-nowrap md:py-0">
        <MobileNavButton />
        <span className="flex items-center gap-2 font-semibold text-fg">
          <Users className="h-6 w-6 text-fg-subtle" /> {term('affiliate', true)}
        </span>
        <span className="hidden h-6 w-px bg-line-strong md:block" />
        <nav className="-mx-1.5 flex w-[calc(100%+12px)] items-center justify-between overflow-x-auto md:mx-0 md:w-auto md:justify-start md:gap-2" aria-label={`${term('affiliate')} filters`}>
          {(['online', 'all', 'pending', 'blocked'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={clsx('flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[15px] font-medium md:px-2', tab === t ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
            >
              {t === 'online' ? 'Online' : t === 'all' ? 'All' : t === 'pending' ? 'Pending' : 'Blocked'}
              {t === 'pending' && pendingCount > 0 && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{pendingCount}</span>}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={tab === 'add'}
            onClick={() => setTab('add')}
            className={clsx('shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[15px] font-medium md:px-2', tab === 'add' ? 'bg-transparent text-online' : 'bg-online text-void hover:brightness-110')}
          >
            Add {term('affiliate')}
          </button>
        </nav>
      </header>

      {tab === 'add' ? (
        <AddAffiliate />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <label className="mx-8 mb-4 flex h-9 items-center gap-2 rounded-md bg-void px-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search" className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
            <Search className="h-4 w-4 text-fg-subtle" />
          </label>
          <h2 className="mx-8 mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            {title} — {rows.length}
          </h2>
          <div role="list" className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            {rows.map((r) => (
              <Row key={r.user.id} rel={r} />
            ))}
            {rows.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-24 text-center text-fg-muted">
                <PixelStar size={48} />
                <p>
                  {tab === 'online'
                    ? `No ${term('affiliate', true).toLowerCase()} are online. Their signals will appear here.`
                    : tab === 'pending'
                      ? `There are no pending ${term('affiliationRequest', true).toLowerCase()}.`
                      : tab === 'blocked'
                        ? "You haven't blocked anyone."
                        : `You have no ${term('affiliate', true).toLowerCase()} yet.`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

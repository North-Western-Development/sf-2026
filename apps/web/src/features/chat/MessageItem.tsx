import { memo, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { CornerUpLeft, Pencil, SmilePlus, MoreHorizontal, Pin, AlertCircle, FileText, Download, Forward, MessageSquarePlus } from 'lucide-react';
import { Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { useStore } from '../../data/store';
import { explicitlyMentionsMe } from '../../data/notifications';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { deleteMessage, editMessage, retryMessage, setPinned, toggleReaction } from '../../data/actions';
import { removeMessage } from '../../data/store';
import type { ChannelKey, Transmission } from '../../lib/types';
import { parseChannelKey } from '../../lib/types';
import { formatFullDate, formatMessageTime, formatShortTime, formatBytes } from '../../lib/time';
import { confirmAction, openModal, openPopout, toast, useUi } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown, toPlainText } from './markdown';
import { useMarkdownResolvers, glyphUrl } from './resolvers';
import { EmojiPicker } from './EmojiPicker';

const QUICK_REACTIONS = ['👍', '❤️', '😂'];

function ReactionChip({ r, onToggle }: { r: Transmission['reactions'][number]; onToggle: () => void }) {
  const custom = r.emoji.startsWith('custom:');
  const url = custom ? r.glyph?.url ?? glyphUrl(r.emoji.slice(7)) : null;
  return (
    <button
      type="button"
      aria-pressed={r.me}
      aria-label={`${r.count} reaction${r.count === 1 ? '' : 's'}, react with ${custom ? r.glyph?.name ?? 'glyph' : r.emoji}`}
      onClick={onToggle}
      className={clsx(
        'flex h-6 items-center gap-1.5 rounded-md border px-1.5 text-sm transition-colors',
        r.me ? 'border-brand bg-brand-soft text-brand-sky' : 'border-transparent bg-raised text-fg-muted hover:border-line-strong'
      )}
    >
      {url ? <img src={url} alt="" className="h-4 w-4 object-contain" /> : <span className="text-base leading-none">{r.emoji}</span>}
      <span className="text-xs font-semibold tabular-nums">{r.count}</span>
    </button>
  );
}

function Attachments({ items }: { items: Transmission['attachments'] }) {
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {items.map((a) => {
        const isImage = a.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.filename);
        const isVideo = a.mimeType?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(a.filename);
        if (isImage)
          return (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer noopener" className="block max-w-[400px] overflow-hidden rounded-md">
              <img src={a.url} alt={a.filename} loading="lazy" className="max-h-[350px] w-auto object-contain" />
            </a>
          );
        if (isVideo) return <video key={a.id} src={a.url} controls className="max-h-[350px] max-w-[400px] rounded-md" />;
        return (
          <div key={a.id} className="flex max-w-[432px] items-center gap-3 rounded-md border border-line bg-raised p-3">
            <FileText className="h-8 w-8 shrink-0 text-brand-sky" />
            <div className="min-w-0 flex-1">
              <a href={a.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm text-brand-sky hover:underline">
                {a.filename}
              </a>
              <span className="text-xs text-fg-subtle">{formatBytes(a.size)}</span>
            </div>
            <a href={a.url} download={a.filename} aria-label={`Download ${a.filename}`} className="text-fg-subtle hover:text-fg">
              <Download className="h-5 w-5" />
            </a>
          </div>
        );
      })}
    </div>
  );
}

function InlineEditor({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        value={value}
        rows={Math.min(10, value.split('\n').length)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSave(value);
          }
        }}
        className="w-full resize-none rounded-md bg-overlay px-3 py-2 text-[15px] text-fg outline-none"
      />
      <p className="mt-1 text-xs text-fg-subtle">
        escape to <button className="text-brand-sky hover:underline" onClick={onCancel}>cancel</button> • enter to{' '}
        <button className="text-brand-sky hover:underline" onClick={() => onSave(value)}>save</button>
      </p>
    </div>
  );
}

export interface MessageItemProps {
  message: Transmission;
  channelKey: ChannelKey;
  beaconId?: string;
  grouped: boolean;
  onReply: (id: string) => void;
  onJumpTo?: (id: string) => void;
}

export const MessageItem = memo(function MessageItem({ message: m, channelKey: key, beaconId, grouped, onReply, onJumpTo }: MessageItemProps) {
  const me = useStore((s) => s.me);
  const pingsMe = useStore((s) => explicitlyMentionsMe(s, key, m));
  const { type: chType, id: chId } = parseChannelKey(key);
  const perms = useStore((s) => (chType === 'relay' ? relayPermissions(s, chId) : null));
  const editing = useUi((s) => s.editing?.key === key && s.editing.messageId === m.id);
  const { openContextMenu } = useContextMenu();
  const resolvers = useMarkdownResolvers(beaconId);
  const [pickerFor, setPickerFor] = useState<DOMRect | null>(null);
  const isMine = m.author.id === me?.id;
  const canManage = perms === null ? isMine : can(perms, PERMISSIONS.MANAGE_TRANSMISSIONS);
  const canPin = perms === null ? true : can(perms, PERMISSIONS.PIN_TRANSMISSIONS) || can(perms, PERMISSIONS.MANAGE_TRANSMISSIONS);
  const canReact = perms === null ? true : can(perms, PERMISSIONS.ADD_REACTIONS);

  const openProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    openPopout({ userId: m.author.id, beaconId, rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), side: 'right' });
  };
  const startEdit = () => useUi.setState({ editing: { key, messageId: m.id } });
  const stopEdit = () => useUi.setState({ editing: null });
  const react = (emoji: string) => void toggleReaction(key, m.id, emoji);
  const remove = () =>
    confirmAction({
      title: 'Delete Transmission',
      body: 'Are you sure you want to delete this transmission?',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => deleteMessage(key, m.id),
    });

  const menu = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (canReact && !m.pending)
      items.push({
        label: 'Add Reaction',
        children: [
          ...['👍', '❤️', '😂', '😮', '😢', '🎉', '🚀', '👀'].map((e) => ({ label: e, onClick: () => react(e) })),
        ],
      });
    if (isMine && !m.pending) items.push({ label: 'Edit Transmission', onClick: startEdit });
    if (!m.pending) items.push({ label: 'Reply', onClick: () => onReply(m.id) });
    items.push(
      { label: 'Forward', disabled: true, sublabel: 'Coming soon' },
      { label: 'Create Thread', disabled: true, sublabel: 'Coming soon' },
      { separator: true },
      { label: 'Copy Text', onClick: () => void navigator.clipboard?.writeText(m.content) }
    );
    if (canPin && !m.pending) items.push({ label: m.pinned ? 'Unpin Transmission' : 'Pin Transmission', onClick: () => void setPinned(key, m.id, !m.pinned).catch(() => toast('Could not update pin', 'error')) });
    items.push({
      label: 'Copy Transmission Link',
      onClick: () => {
        const base = beaconId ? `/channels/${beaconId}/${chId}` : `/channels/@me/${chId}`;
        void navigator.clipboard?.writeText(`${window.location.origin}${base}?m=${m.id}`);
        toast('Link copied');
      },
    });
    if ((isMine || canManage) && !m.pending) items.push({ separator: true }, { label: 'Delete Transmission', danger: true, onClick: remove });
    if (!isMine) items.push({ separator: true }, { label: 'Report Transmission', danger: true, onClick: () => openModal({ kind: 'report', targetType: 'transmission', targetId: m.id, context: { channel: key } }) });
    items.push({ separator: true }, { label: 'Copy Transmission ID', onClick: () => void navigator.clipboard?.writeText(m.id) });
    return items;
  };

  if (m.type === 'system_pin') {
    return (
      <div className="flex items-center gap-4 py-1 pl-4 pr-12 text-sm text-fg-muted">
        <Pin className="ml-3 h-4 w-4 text-fg-subtle" />
        <span>
          <button className="font-semibold text-fg hover:underline" onClick={openProfile}>
            <UserName user={m.author} beaconId={beaconId} styled={false} />
          </button>{' '}
          pinned a transmission to this relay. <span className="text-xs text-fg-subtle">{formatMessageTime(m.createdAt)}</span>
        </span>
      </div>
    );
  }

  return (
    <article
      id={`msg-${m.id}`}
      aria-label={`${m.author.displayName || m.author.username}, ${formatFullDate(m.createdAt)}`}
      onContextMenu={(e) => openContextMenu(e, menu())}
      className={clsx(
        'group relative pl-[72px] pr-12',
        grouped ? 'py-0.5' : 'mt-4 py-0.5',
        pingsMe ? 'bg-mention-bg before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-mention hover:bg-star-soft' : 'hover:bg-raised/60',
        m.pending && 'opacity-60'
      )}
    >
      {m.replyTo && (
        <div className="relative mb-1 flex items-center gap-1.5 text-sm text-fg-subtle before:absolute before:-left-9 before:top-1/2 before:h-3 before:w-8 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-line-strong">
          {m.replyTo.deleted || !m.replyTo.author ? (
            <span className="italic">Original transmission was deleted</span>
          ) : (
            <>
              <Avatar user={m.replyTo.author} size={16} />
              <span className="shrink-0 font-medium text-fg-muted">
                @<UserName user={m.replyTo.author} beaconId={beaconId} styled={false} />
              </span>
              <button type="button" onClick={() => onJumpTo?.(m.replyTo!.id)} className="min-w-0 truncate text-left hover:text-fg">
                {toPlainText(m.replyTo.content, resolvers) || (m.replyTo.attachmentsCount ? 'Click to see attachment' : '')}
              </button>
            </>
          )}
        </div>
      )}

      {grouped ? (
        <Tooltip content={formatFullDate(m.createdAt)}>
          <time
            dateTime={m.createdAt}
            className="absolute left-0 w-[72px] pt-0.5 text-center text-[11px] leading-[22px] text-fg-subtle opacity-0 group-hover:opacity-100"
          >
            {formatShortTime(m.createdAt)}
          </time>
        </Tooltip>
      ) : (
        <>
          <button type="button" aria-label="Open profile" onClick={openProfile} className="absolute left-4 mt-0.5 rounded-full">
            <Avatar user={m.author} size={40} />
          </button>
          <h3 className="flex items-baseline gap-2 leading-[22px]">
            <button type="button" onClick={openProfile} className="min-w-0 font-medium hover:underline">
              <UserName user={m.author} beaconId={beaconId} />
            </button>
            {(m.author.staffRank ?? 0) >= 1 && (
              <span className="rounded-xs bg-brand px-1 text-[10px] font-bold uppercase leading-4 text-on-brand">Staff</span>
            )}
            <Tooltip content={formatFullDate(m.createdAt)}>
              <time dateTime={m.createdAt} className="text-xs text-fg-subtle">
                {formatMessageTime(m.createdAt)}
              </time>
            </Tooltip>
          </h3>
        </>
      )}

      {editing ? (
        <InlineEditor
          initial={m.content}
          onCancel={stopEdit}
          onSave={(v) => {
            stopEdit();
            if (!v.trim()) remove();
            else if (v !== m.content) void editMessage(key, m.id, v).catch(() => toast('Could not edit transmission', 'error'));
          }}
        />
      ) : (
        <div className={clsx('text-[15px] leading-[22px] text-fg', m.failed && 'text-danger')}>
          <Markdown content={m.content} resolvers={resolvers} />
          {m.editedAt && (
            <Tooltip content={formatFullDate(m.editedAt)}>
              <span className="ml-1 text-[11px] text-fg-subtle">(edited)</span>
            </Tooltip>
          )}
        </div>
      )}

      <Attachments items={m.attachments} />

      {m.failed && (
        <div className="mt-1 flex items-center gap-2 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5" /> Transmission failed to send.
          <button className="text-brand-sky hover:underline" onClick={() => void retryMessage(key, m.id)}>
            Retry
          </button>
          <button className="text-fg-subtle hover:underline" onClick={() => removeMessage(key, m.id)}>
            Dismiss
          </button>
        </div>
      )}

      {m.reactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.reactions.map((r) => (
            <ReactionChip key={r.emoji} r={r} onToggle={() => react(r.emoji)} />
          ))}
          {canReact && (
            <Tooltip content="Add Reaction">
              <button
                type="button"
                aria-label="Add Reaction"
                onClick={(e) => setPickerFor(e.currentTarget.getBoundingClientRect())}
                className="flex h-6 items-center rounded-md bg-raised px-1.5 text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100"
              >
                <SmilePlus className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {!m.pending && !m.failed && !editing && (
        <div className="absolute -top-4 right-4 z-10 hidden items-center rounded-md bg-overlay shadow-pop group-hover:flex">
          {canReact &&
            QUICK_REACTIONS.map((e) => (
              <button key={e} type="button" aria-label={`React with ${e}`} onClick={() => react(e)} className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-hover">
                {e}
              </button>
            ))}
          {canReact && (
            <ActionButton label="Add Reaction" onClick={(e) => setPickerFor(e.currentTarget.getBoundingClientRect())}>
              <SmilePlus className="h-5 w-5" />
            </ActionButton>
          )}
          {isMine ? (
            <ActionButton label="Edit" onClick={startEdit}>
              <Pencil className="h-5 w-5" />
            </ActionButton>
          ) : (
            <ActionButton label="Reply" onClick={() => onReply(m.id)}>
              <CornerUpLeft className="h-5 w-5" />
            </ActionButton>
          )}
          <ActionButton label="Forward (Coming soon)" disabled onClick={() => {}}>
            <Forward className="h-5 w-5" />
          </ActionButton>
          <ActionButton label="Create Thread (Coming soon)" disabled onClick={() => {}}>
            <MessageSquarePlus className="h-5 w-5" />
          </ActionButton>
          <ActionButton label="More" onClick={(e) => openContextMenu({ clientX: e.clientX, clientY: e.clientY }, menu())}>
            <MoreHorizontal className="h-5 w-5" />
          </ActionButton>
        </div>
      )}

      {pickerFor && (
        <EmojiPicker
          anchor={pickerFor}
          beaconId={beaconId}
          onClose={() => setPickerFor(null)}
          onPick={(emoji) => {
            setPickerFor(null);
            react(emoji);
          }}
        />
      )}
    </article>
  );
});

function ActionButton({ label, onClick, disabled, children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
      >
        {children}
      </button>
    </Tooltip>
  );
}

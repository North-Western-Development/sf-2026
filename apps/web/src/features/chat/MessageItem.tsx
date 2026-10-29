import { PollCard } from './Polls';
import { markUnread, reminderChoices, remindMe, setBookmarked, useInbox } from '../inbox/inboxData';
import { VoiceMessagePlayer } from './VoiceMessages';
import { Emoji } from '../../lib/emoji';
import { memo, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { CornerUpLeft, Pencil, SmilePlus, MoreHorizontal, Pin, AlertCircle, Forward, MessageSquarePlus, Phone, PhoneMissed, Lock, Eye } from 'lucide-react';
import { Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { useStore } from '../../data/store';
import { explicitlyMentionsMe } from '../../data/notifications';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { deleteMessage, editMessage, retryMessage, setPinned, toggleReaction } from '../../data/actions';
import { removeMessage } from '../../data/store';
import type { ChannelKey, Transmission } from '../../lib/types';
import { parseChannelKey } from '../../lib/types';
import { formatFullDate, formatMessageTime, formatShortTime } from '../../lib/time';
import { http } from '../../lib/http';
import { confirmAction, openModal, openPopout, toast, useUi } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown, toPlainText } from './markdown';
import { useMarkdownResolvers, glyphUrl } from './resolvers';
import { EmojiPicker } from './EmojiPicker';
import { Embeds } from './Embeds';
import { SealedAttachments, SealedNotice } from './EncryptedBits';
import { useChatPrefs } from '../../lib/chatPrefs';
import { copyText } from '../../lib/clipboard';
import { prefetchProfile } from '../profile/useProfile';
import { RichInput, type RichInputHandle } from '../common/RichInput';
import { AutomodAlertMessage, JoinMessage, SetupTipsMessage } from './SystemMessages';
import { BeaconTag } from '../common/BeaconTag';
import { AppTag } from '../common/AppTag';
import { ThreadChip, ThreadStartedMessage, startThread } from './ThreadParts';
import { ForwardedBox } from './ForwardedBox';
import { Attachments } from './Attachments';
export { Attachments };
import { useNavigate } from 'react-router';
import { useLocalePrefs } from '../../lib/locale';
import { shouldFilter, useExplicitPrefs } from '../../lib/explicitFilter';

const QUICK_REACTIONS = ['👍', '❤️', '😂'];

/** A call transmission's content: when it started, and once over, when it ended and who joined. */
function parseCallContent(content: string): { startedAt?: string; endedAt?: string; joined?: string[] } {
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function callDuration(start: string, end: string): string {
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  if (minutes < 1) return 'a few seconds';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

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
      {url ? <img src={url} alt="" className="h-4 w-4 object-contain" /> : <Emoji emoji={r.emoji} size={16} />}
      <span className="text-xs font-semibold tabular-nums">{r.count}</span>
    </button>
  );
}


function InlineEditor({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<RichInputHandle>(null);
  useEffect(() => {
    ref.current?.setCaret(initial.length);
  }, []);
  return (
    <div className="mt-1">
      <RichInput
        ref={ref}
        wrapperClassName="w-full rounded-md bg-overlay"
        value={value}
        aria-label="Edit transmission"
        onChange={(v) => setValue(v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSave(value);
          }
        }}
        className="max-h-[50vh] px-3 py-2 text-[15px] leading-[22px]"
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

export const MessageItem = memo(function MessageItem({ message: m, channelKey: key, beaconId, grouped: groupedProp, onReply, onJumpTo }: MessageItemProps) {
  // A command's answer and a message only you see always start with their own header.
  const grouped = groupedProp && !m.interaction && !m.ephemeral;
  const me = useStore((s) => s.me);
  const authorTag = useStore((s) => s.users[m.author.id]?.tagBeaconId ?? m.author.tagBeaconId);
  // A link that is only an image or GIF shows just the picture, as Discord does (the link comes back with previews off).
  const showEmbeds = useChatPrefs((p) => p.showEmbeds);
  const compact = useChatPrefs((p) => p.compact);
  useLocalePrefs(); // times re-render when Language & Time changes
  const mediaOnly = showEmbeds && !m.encrypted && m.embeds.length === 1 && m.embeds[0].type === 'image' && m.content.trim() === m.embeds[0].url;
  const pingsMe = useStore((s) => explicitlyMentionsMe(s, key, m));
  const { type: chType, id: chId } = parseChannelKey(key);
  const perms = useStore((s) => (chType === 'relay' ? relayPermissions(s, chId) : null));
  const editing = useUi((s) => s.editing?.key === key && s.editing.messageId === m.id);
  const { openContextMenu } = useContextMenu();
  const resolvers = useMarkdownResolvers(beaconId);
  const [pickerFor, setPickerFor] = useState<DOMRect | null>(null);
  const isMine = m.author.id === me?.id;
  // Encrypted replies: the server cannot quote the original, so read it from this device.
  const replyText = useStore((s) => (m.replyTo ? s.messages[key]?.byId[m.replyTo.id]?.content : undefined));
  const canManage = perms === null ? isMine : can(perms, PERMISSIONS.MANAGE_TRANSMISSIONS);
  const canPin = perms === null ? true : can(perms, PERMISSIONS.PIN_TRANSMISSIONS) || can(perms, PERMISSIONS.MANAGE_TRANSMISSIONS);
  const canReact = perms === null ? true : can(perms, PERMISSIONS.ADD_REACTIONS);
  const navigate = useNavigate();
  const relay = useStore((s) => (chType === 'relay' ? s.relays[chId] : undefined));
  const ordinary = (m.type === 'default' || m.type === 'reply') && !m.pending;
  // Threads start from transmissions in text relays (Discord's "Create Thread").
  const canThread = ordinary && relay?.type === 'text' && !m.thread && perms !== null && can(perms, PERMISSIONS.CREATE_THREADS);
  const canForward = ordinary && !m.encrypted;
  const forward = () => openModal({ kind: 'forward', channelKey: key, messageId: m.id });
  // Sensitive media: checked on this device when the viewer's or the beacon's filter asks for it.
  const explicitPrefs = useExplicitPrefs();
  const filterMedia = useStore((s) =>
    shouldFilter({
      prefs: explicitPrefs,
      channelType: chType,
      mine: m.author.id === s.me?.id,
      authorIsFriend: s.relationships[m.author.id]?.type === 'friend',
      beaconFilter: beaconId ? s.beacons[beaconId]?.explicitFilter : undefined,
      authorHasClearance: !!(beaconId && s.members[beaconId]?.[m.author.id]?.clearanceIds.length),
    })
  );

  const openProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    openPopout({ userId: m.author.id, beaconId, rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), side: 'right' });
  };
  const warmProfile = () => prefetchProfile(m.author.id, beaconId);
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
    if (canForward) items.push({ label: 'Forward', onClick: forward });
    if (canThread) items.push({ label: 'Create Thread', onClick: () => startThread(relay!, navigate, m) });
    if (!m.pending) {
      const bookmarked = !!useInbox.getState().bookmarked?.has(m.id);
      items.push(
        { separator: true },
        { label: 'Mark Unread', onClick: () => void markUnread(key, m.id) },
        { label: bookmarked ? 'Remove Bookmark' : 'Bookmark', onClick: () => void setBookmarked(m.id, !bookmarked) },
        { label: 'Remind Me', children: reminderChoices().map((c) => ({ label: c.label, onClick: () => void remindMe(m.id, c.at) })) }
      );
    }
    items.push({ separator: true }, { label: 'Copy Text', onClick: () => void copyText(m.content) });
    // Announcement relays: send it to every relay that follows this one (your own, or anyone's with Manage Transmissions).
    if (relay?.isAnnouncement && !m.publishedAt && !m.pending && (isMine || canManage) && (m.type === 'default' || m.type === 'reply'))
      items.push({
        label: 'Publish',
        onClick: () =>
          void http
            .post<{ delivered: number }>(`/channels/relay/${chId}/transmissions/${m.id}/publish`)
            .then((r) => toast(r.delivered ? `Published to ${r.delivered} following ${r.delivered === 1 ? 'relay' : 'relays'}` : 'Published', 'success'))
            .catch((err) => toast((err as Error).message, 'error')),
      });
    if (canPin && !m.pending) items.push({ label: m.pinned ? 'Unpin Transmission' : 'Pin Transmission', onClick: () => void setPinned(key, m.id, !m.pinned).catch(() => toast('Could not update pin', 'error')) });
    items.push({
      label: 'Copy Transmission Link',
      onClick: () => {
        const base = beaconId ? `/channels/${beaconId}/${chId}` : `/channels/@me/${chId}`;
        void copyText(`${window.location.origin}${base}?m=${m.id}`, 'Link copied');
      },
    });
    if ((isMine || canManage) && !m.pending) items.push({ separator: true }, { label: 'Delete Transmission', danger: true, onClick: remove });
    if (!isMine) items.push({ separator: true }, { label: 'Report Transmission', danger: true, onClick: () => openModal({ kind: 'report', targetType: 'transmission', targetId: m.id, context: { channel: key } }) });
    items.push({ separator: true }, { label: 'Copy Transmission ID', onClick: () => void copyText(m.id) });
    return items;
  };

  if (m.type === 'system_encryption') {
    return (
      <div id={`msg-${m.id}`} role="note" className="flex items-center gap-4 py-1 pl-4 pr-12 text-sm text-fg-muted">
        <Lock className="ml-3 h-4 w-4 text-online" />
        <span>
          <button className="font-semibold text-fg hover:underline" onClick={openProfile} onPointerEnter={warmProfile}>
            <UserName user={m.author} styled={false} />
          </button>{' '}
          turned on end-to-end encryption. Transmissions from here on can only be read on your devices.{' '}
          <span className="text-xs text-fg-subtle">{formatMessageTime(m.createdAt)}</span>
        </span>
      </div>
    );
  }

  if (m.type === 'system_call') {
    const info = parseCallContent(m.content);
    const missed = !!info.endedAt && !isMine && !!me && !info.joined?.includes(me.id);
    const Icon = missed ? PhoneMissed : Phone;
    return (
      <div id={`msg-${m.id}`} role="note" className="flex items-center gap-4 py-1 pl-4 pr-12 text-sm text-fg-muted">
        <Icon className={clsx('ml-3 h-4 w-4', missed ? 'text-danger' : 'text-online')} />
        <span>
          {missed ? 'You missed a call from ' : null}
          <button className="font-semibold text-fg hover:underline" onClick={openProfile} onPointerEnter={warmProfile}>
            <UserName user={m.author} styled={false} />
          </button>
          {missed ? '' : ' started a call'}
          {info.endedAt ? ` that lasted ${callDuration(info.startedAt ?? m.createdAt, info.endedAt)}.` : '.'}{' '}
          <span className="text-xs text-fg-subtle">{formatMessageTime(m.createdAt)}</span>
        </span>
      </div>
    );
  }

  if (m.type === 'system_join') return <JoinMessage m={m} channelKey={key} beaconId={beaconId} onOpenProfile={openProfile} />;
  if (m.type === 'system_tips') return <SetupTipsMessage m={m} beaconId={beaconId} />;
  if (m.type === 'system_thread') return <ThreadStartedMessage m={m} beaconId={beaconId} onOpenProfile={openProfile} />;
  if (m.type === 'system_automod') return <AutomodAlertMessage m={m} beaconId={beaconId} onOpenProfile={openProfile} />;

  if (m.type === 'system_pin') {
    return (
      <div className="flex items-center gap-4 py-1 pl-4 pr-12 text-sm text-fg-muted">
        <Pin className="ml-3 h-4 w-4 text-fg-subtle" />
        <span>
          <button className="font-semibold text-fg hover:underline" onClick={openProfile} onPointerEnter={warmProfile}>
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
      onContextMenu={(e) => (m.ephemeral ? e.preventDefault() : openContextMenu(e, menu()))}
      className={clsx(
        'group relative pl-[72px] pr-12',
        m.ephemeral && 'bg-brand/5',
        compact ? 'py-0.5' : grouped ? 'py-0.5' : 'mt-4 py-0.5',
        pingsMe ? 'bg-mention-bg before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-mention hover:bg-star-soft' : 'hover:bg-raised/60',
        m.pending && 'opacity-60'
      )}
    >
      {m.interaction && (
        <div className="relative mb-1 flex items-center gap-1.5 text-sm text-fg-subtle before:absolute before:-left-9 before:top-1/2 before:h-3 before:w-8 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-line-strong">
          {m.interaction.user && <Avatar user={m.interaction.user} size={16} />}
          {m.interaction.user && (
            <span className="shrink-0 font-medium text-fg-muted">
              <UserName user={m.interaction.user} beaconId={beaconId} styled={false} />
            </span>
          )}
          <span>
            used <span className="font-medium text-brand-sky">/{m.interaction.name}</span>
          </span>
        </div>
      )}
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
                {toPlainText(replyText ?? m.replyTo.content, resolvers) || (m.replyTo.attachmentsCount ? 'Click to see attachment' : '')}
              </button>
            </>
          )}
        </div>
      )}

      {compact ? (
        // Discord's compact display: time, then the name, on every transmission; no avatars.
        <Tooltip content={formatFullDate(m.createdAt)}>
          <time dateTime={m.createdAt} className="absolute left-0 w-[72px] pt-0.5 text-center text-[11px] leading-[22px] text-fg-subtle">
            {formatShortTime(m.createdAt)}
          </time>
        </Tooltip>
      ) : grouped ? (
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
          <button type="button" aria-label="Open profile" onClick={openProfile} onPointerEnter={warmProfile} className="absolute left-4 mt-0.5 rounded-full">
            <Avatar user={m.author} size={40} />
          </button>
          <h3 className="flex items-baseline gap-2 leading-[22px]">
            <button type="button" onClick={openProfile} onPointerEnter={warmProfile} className="min-w-0 truncate font-medium hover:underline">
              <UserName user={m.author} beaconId={beaconId} />
            </button>
            <BeaconTag beaconId={authorTag} className="self-center" />
            <AppTag user={m.author} crosspost={!!m.crosspost} className="self-center" />
            {(m.author.staffRank ?? 0) >= 1 && (
              <span className="rounded-xs bg-brand px-1 text-[10px] font-bold uppercase leading-4 text-on-brand">Staff</span>
            )}
            <Tooltip content={formatFullDate(m.createdAt)}>
              <time dateTime={m.createdAt} className="shrink-0 whitespace-nowrap text-xs text-fg-subtle">
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
        <div className={clsx('text-[15px] leading-[22px] text-fg', m.failed && 'text-danger', compact && 'flex gap-2')}>
          {compact && (
            <button type="button" onClick={openProfile} onPointerEnter={warmProfile} className="shrink-0 font-medium hover:underline">
              <UserName user={m.author} beaconId={beaconId} />
            </button>
          )}
          {m.thinking && (
            <span className="italic text-fg-muted">
              <UserName user={m.author} beaconId={beaconId} styled={false} /> is thinking<span className="animate-pulse">…</span>
            </span>
          )}
          {m.encrypted && m.e2ee !== 'ok' ? <SealedNotice state={m.e2ee} /> : mediaOnly ? null : <Markdown content={m.content} resolvers={resolvers} />}
          {m.editedAt && (
            <Tooltip content={formatFullDate(m.editedAt)}>
              <span className="ml-1 text-[11px] text-fg-subtle">(edited)</span>
            </Tooltip>
          )}
        </div>
      )}

      {!!m.stickers?.length && (
        <div className="mt-1 flex gap-2">
          {m.stickers.map((s, i) => (
            <Tooltip key={`${s.id}-${i}`} content={s.name}>
              <img src={s.url} alt={`Sticker ${s.name}`} className="h-40 w-40 object-contain" draggable={false} />
            </Tooltip>
          ))}
        </div>
      )}
      {m.poll && <PollCard m={m} channelKey={key} />}
      {m.forwarded && <ForwardedBox forwarded={m.forwarded} beaconId={beaconId} filter={filterMedia} />}
      {m.voiceMessage && m.attachments[0] ? <VoiceMessagePlayer attachment={m.attachments[0]} /> : <Attachments items={m.attachments} filter={filterMedia} />}
      <SealedAttachments items={m.encryptedAttachments} />
      <Embeds embeds={m.embeds} messageId={m.id} canRemove={isMine || (chType !== 'link' && chType !== 'mesh' && canManage)} filter={filterMedia} />
      {m.thread && <ThreadChip m={m} beaconId={beaconId} />}
      {m.ephemeral && (
        <div className="mt-1 flex items-center gap-1 text-xs text-fg-subtle">
          <Eye className="h-3.5 w-3.5" aria-hidden /> Only you can see this ·
          <button type="button" className="text-brand-sky hover:underline" onClick={() => removeMessage(key, m.id)}>
            Dismiss transmission
          </button>
        </div>
      )}

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

      {!m.pending && !m.failed && !editing && !m.ephemeral && (
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
          {canForward && (
            <ActionButton label="Forward" onClick={forward}>
              <Forward className="h-5 w-5" />
            </ActionButton>
          )}
          {canThread && (
            <ActionButton label="Create Thread" onClick={() => startThread(relay!, navigate, m)}>
              <MessageSquarePlus className="h-5 w-5" />
            </ActionButton>
          )}
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

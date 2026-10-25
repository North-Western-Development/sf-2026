import { Emoji } from '../../lib/emoji';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AtSign, CirclePlus, Cloud, Smile, Sticker, X, FileUp, Hash } from 'lucide-react';
import { ComingSoon, Tooltip, useContextMenu } from '@subspace/ui';
import { useStore, getState } from '../../data/store';
import { notifyTyping, sendMessage } from '../../data/actions';
import { relayPermissions, can, PERMISSIONS, myTimeout } from '../../data/permissions';
import { parseChannelKey, type ChannelKey, type UserRef } from '../../lib/types';
import { resolveName } from '../../lib/normalize';
import { useUi, toast, openModal } from '../../app/ui';
import { uploadToVault } from '../../lib/uploads';
import { sealFile } from '../../lib/e2ee/client';
import { isEncryptedChannel } from '../../data/e2ee';

type SealedAttachment = { url: string; key: string; filename: string; mimeType: string; size: number };
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { EmojiPicker, EMOJI_INDEX, loadGlyphs, type Glyph } from './EmojiPicker';
import { OnboardingGate, useNeedsOnboarding } from '../onboarding/OnboardingGate';
import { RichInput, type RichInputHandle } from '../common/RichInput';

const MAX_LENGTH = 2000;

type Suggestion =
  | { kind: 'user'; id: string; label: string; user: UserRef; insert: string; token: string }
  | { kind: 'role'; id: string; label: string; color: string; insert: string; token: string }
  | { kind: 'special'; id: string; label: string; description: string; insert: string; token: string }
  | { kind: 'relay'; id: string; label: string; insert: string; token: string }
  | { kind: 'emoji'; id: string; label: string; emoji?: string; glyph?: Glyph; insert: string; token: string };

interface Trigger {
  char: '@' | '#' | ':';
  query: string;
  start: number;
}

/** A GIF glyph drawn like the lucide icons beside it (same box and stroke). */
function GifIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M10 9.5H8.25A1.25 1.25 0 0 0 7 10.75v2.5A1.25 1.25 0 0 0 8.25 14.5H10V12H9" />
      <path d="M12.5 9.5v5" />
      <path d="M17 9.5h-2v5M15 12h1.5" />
    </svg>
  );
}

function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)([@#:])([^\s@#:]{0,32})$/);
  if (!m) return null;
  if (m[2] === ':' && m[3].length < 2) return null;
  return { char: m[2] as Trigger['char'], query: m[3].toLowerCase(), start: caret - m[3].length - 1 };
}

/** Replace inserted display labels with wire tokens (longest labels first). */
export function encodeMentions(text: string, tokens: Map<string, string>): string {
  const labels = [...tokens.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const label of labels) out = out.split(label).join(tokens.get(label)!);
  return out;
}

export function Composer({
  channelKey: key,
  beaconId,
  placeholder,
  disabledReason,
}: {
  channelKey: ChannelKey;
  beaconId?: string;
  placeholder: string;
  /** Replaces the composer with a notice (e.g. a locked thread). */
  disabledReason?: string | null;
}) {
  const { type, id } = parseChannelKey(key);
  const [text, setText] = useState(() => sessionStorage.getItem(`draft:${key}`) ?? '');
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null);
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [attachmentIds, setAttachmentIds] = useState<Array<{ id: string; name: string; sealed?: SealedAttachment }>>([]);
  const encrypted = useStore((s) => isEncryptedChannel(key) && !!s.me);
  const tokens = useRef(new Map<string, string>());
  const area = useRef<RichInputHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { openContextMenu } = useContextMenu();

  const reply = useUi((s) => s.replyingTo[key]);
  const replyMsg = useStore((s) => (reply ? s.messages[key]?.byId[reply.messageId] : undefined));
  const perms = useStore((s) => (type === 'relay' ? relayPermissions(s, id) : null));
  const canSend = perms === null || can(perms, PERMISSIONS.SEND_TRANSMISSIONS);
  const canAttach = perms === null || can(perms, PERMISSIONS.ATTACH_FILES);
  const canEveryone = perms === null ? false : can(perms, PERMISSIONS.MENTION_EVERYONE);
  const needsOnboarding = useNeedsOnboarding(type === 'relay' ? beaconId : undefined);
  const timedOutUntil = useStore((s) => (type === 'relay' && beaconId ? myTimeout(s, beaconId) : null));
  // Re-render when a timeout runs out so the composer comes back on its own.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timedOutUntil) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), new Date(timedOutUntil).getTime() - Date.now() + 500);
    return () => window.clearTimeout(t);
  }, [timedOutUntil]);

  // Reset per channel.
  useEffect(() => {
    setText(sessionStorage.getItem(`draft:${key}`) ?? '');
    setAttachmentIds([]);
    tokens.current.clear();
    area.current?.focus();
  }, [key]);

  useEffect(() => {
    if (beaconId) void loadGlyphs(beaconId).then(setGlyphs);
  }, [beaconId]);

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`draft:${key}`, text);
      else sessionStorage.removeItem(`draft:${key}`);
    } catch {
      /* ignore */
    }
  }, [text, key]);

  // Focus composer when replying.
  useEffect(() => {
    if (reply) area.current?.focus();
  }, [reply]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger) return [];
    const s = getState();
    const q = trigger.query;
    if (trigger.char === '@') {
      let people: UserRef[] = [];
      if (type === 'relay' && beaconId) people = Object.values(s.members[beaconId] ?? {}).map((m) => m.user);
      else if (type === 'link') people = [s.links[id]?.recipient, s.me].filter(Boolean) as UserRef[];
      else if (type === 'mesh') people = s.meshes[id]?.members ?? [];
      const users: Suggestion[] = people
        .filter((u) => {
          const member = beaconId ? s.members[beaconId]?.[u.id] : undefined;
          return [u.username, u.displayName ?? '', member?.nickname ?? ''].some((n) => n.toLowerCase().includes(q));
        })
        .slice(0, 8)
        .map((u) => {
          const label = `@${resolveName(u, beaconId ? s.members[beaconId]?.[u.id] : undefined)}`;
          return { kind: 'user', id: u.id, label, user: u, insert: label, token: `<@${u.id}>` };
        });
      const roles: Suggestion[] = beaconId
        ? (s.clearances[beaconId] ?? [])
            .filter((c) => c.position > 0 && c.name.toLowerCase().includes(q))
            .slice(0, 5)
            .map((c) => ({ kind: 'role', id: c.id, label: `@${c.name}`, color: c.color, insert: `@${c.name}`, token: `<@&${c.id}>` }))
        : [];
      const special: Suggestion[] =
        type === 'relay'
          ? (['everyone', 'here'] as const)
              .filter((k) => k.startsWith(q))
              .map((k) => ({
                kind: 'special',
                id: k,
                label: `@${k}`,
                description: canEveryone ? (k === 'everyone' ? 'Notify everyone who can see this relay.' : 'Notify everyone online.') : 'You cannot ping everyone here.',
                insert: `@${k}`,
                token: `@${k}`,
              }))
          : [];
      return [...users, ...roles, ...special];
    }
    if (trigger.char === '#' && beaconId) {
      return (s.relayIdsByBeacon[beaconId] ?? [])
        .map((rid) => s.relays[rid])
        .filter((r) => r && r.type !== 'category' && r.name.toLowerCase().includes(q))
        .slice(0, 10)
        .map((r) => ({ kind: 'relay', id: r.id, label: `#${r.name}`, insert: `#${r.name}`, token: `<#${r.id}>` }));
    }
    if (trigger.char === ':') {
      const g: Suggestion[] = glyphs
        .filter((x) => x.name.toLowerCase().includes(q))
        .slice(0, 4)
        .map((x) => ({ kind: 'emoji', id: x.id, label: `:${x.name}:`, glyph: x, insert: `<:${x.name}:${x.id}>`, token: `<:${x.name}:${x.id}>` }));
      const u: Suggestion[] = EMOJI_INDEX.filter((e) => e.slug.startsWith(q))
        .slice(0, 10 - g.length)
        .map((e) => ({ kind: 'emoji', id: e.slug, label: `:${e.slug}:`, emoji: e.emoji, insert: e.emoji, token: e.emoji }));
      return [...g, ...u];
    }
    return [];
  }, [trigger, type, id, beaconId, glyphs, canEveryone]);

  useEffect(() => setActive(0), [trigger?.query, trigger?.char]);

  const applySuggestion = (sug: Suggestion) => {
    if (!trigger) return;
    const el = area.current!;
    const before = text.slice(0, trigger.start);
    const after = text.slice(el.getSelection()[1]);
    const insert = `${sug.insert} `;
    if (sug.insert !== sug.token) tokens.current.set(sug.insert, sug.token);
    const next = before + insert + after;
    setText(next);
    setTrigger(null);
    requestAnimationFrame(() => el.setCaret(before.length + insert.length));
  };

  const insertAtCaret = (value: string) => area.current?.insert(value);

  const submit = async () => {
    const content = encodeMentions(text, tokens.current).trim();
    if ((!content && !attachmentIds.length) || content.length > MAX_LENGTH) return;
    setText('');
    tokens.current.clear();
    const sealed = attachmentIds.flatMap((a) => (a.sealed ? [a.sealed] : []));
    const opts = {
      replyToId: reply?.messageId,
      replyPing: reply?.ping,
      attachmentIds: !encrypted && attachmentIds.length ? attachmentIds.map((a) => a.id) : undefined,
      encryptedAttachments: encrypted && sealed.length ? sealed : undefined,
    };
    setAttachmentIds([]);
    useUi.setState((s) => ({ replyingTo: { ...s.replyingTo, [key]: undefined } }));
    await sendMessage(key, content, opts);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (suggestions.length && trigger) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[active]);
        return;
      }
      if (e.key === 'Escape') {
        setTrigger(null);
        return;
      }
    }
    if (e.key === 'Escape' && reply) {
      useUi.setState((s) => ({ replyingTo: { ...s.replyingTo, [key]: undefined } }));
      return;
    }
    if (e.key === 'ArrowUp' && !text) {
      const s = getState();
      const ch = s.messages[key];
      const mine = ch?.ids.map((x) => ch.byId[x]).filter((m) => m.author.id === s.me?.id && !m.pending).at(-1);
      if (mine) {
        e.preventDefault();
        useUi.setState({ editing: { key, messageId: mine.id } });
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files).slice(0, 10)) {
      setUploading(file.name);
      try {
        if (encrypted) {
          // Sealed on this device; the vault only ever holds ciphertext.
          const { blob, key: fileKey } = await sealFile(file);
          const saved = await uploadToVault(new File([blob], 'encrypted.bin', { type: 'application/octet-stream' }));
          if (saved) {
            const sealedFile = { url: `/api/v1/vault/files/${saved.id}`, key: fileKey, filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size };
            setAttachmentIds((a) => [...a, { id: saved.id, name: file.name, sealed: sealedFile }]);
          }
        } else {
          const saved = await uploadToVault(file);
          if (saved) setAttachmentIds((a) => [...a, { id: saved.id, name: file.name }]);
        }
      } catch (err) {
        toast(`Upload failed: ${(err as Error).message}`, 'error');
      } finally {
        setUploading(null);
      }
    }
  };

  if (needsOnboarding && beaconId) return <OnboardingGate beaconId={beaconId} />;

  if (!canSend || disabledReason) {
    return (
      <div className="px-4 pb-6">
        <div className="flex h-11 items-center rounded-lg bg-raised px-4 text-sm text-fg-subtle">{disabledReason ||
            (timedOutUntil
              ? `You're timed out until ${new Date(timedOutUntil).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. You can still read along.`
              : 'You do not have permission to transmit in this relay.')}</div>
      </div>
    );
  }

  const over = text.length > MAX_LENGTH;

  return (
    <div className="relative px-4 pb-6">
      {suggestions.length > 0 && trigger && (
        <div role="listbox" className="absolute inset-x-4 bottom-full mb-2 max-h-80 overflow-y-auto rounded-lg bg-overlay p-2 shadow-pop">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            {trigger.char === '@' ? 'Transmitters & Clearances' : trigger.char === '#' ? 'Relays' : 'Emoji matching'} {trigger.query && `“${trigger.query}”`}
          </p>
          {suggestions.map((sug, i) => (
            <button
              key={`${sug.kind}:${sug.id}`}
              role="option"
              aria-selected={i === active}
              type="button"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(sug);
              }}
              className={clsx('flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm', i === active ? 'bg-active' : '')}
            >
              {sug.kind === 'user' && (
                <>
                  <Avatar user={sug.user} size={24} showPresence ring="var(--color-overlay)" />
                  <UserName user={sug.user} beaconId={beaconId} className="font-medium" styled={false} />
                  <span className="text-fg-subtle">{sug.user.username}</span>
                </>
              )}
              {sug.kind === 'role' && <span style={{ color: sug.color }} className="font-medium">{sug.label}</span>}
              {sug.kind === 'special' && (
                <>
                  <AtSign className="h-4 w-4 text-fg-subtle" />
                  <span className="font-medium">{sug.label}</span>
                  <span className="truncate text-fg-subtle">{sug.description}</span>
                </>
              )}
              {sug.kind === 'relay' && (
                <>
                  <Hash className="h-4 w-4 text-fg-subtle" />
                  <span>{sug.label.slice(1)}</span>
                </>
              )}
              {sug.kind === 'emoji' && (
                <>
                  {sug.glyph ? <img src={sug.glyph.url} alt="" className="h-5 w-5 object-contain" /> : <Emoji emoji={sug.emoji ?? ""} size={20} />}
                  <span>{sug.label}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {reply && replyMsg && (
        <div className="flex h-9 items-center gap-2 rounded-t-lg bg-raised px-4 text-sm text-fg-muted">
          <span className="min-w-0 flex-1 truncate">
            Replying to <span className="font-semibold text-fg"><UserName user={replyMsg.author} beaconId={beaconId} styled={false} /></span>
          </span>
          {replyMsg.author.id !== getState().me?.id && (
            <Tooltip content={reply.ping ? 'Click to disable pinging the author' : 'Click to enable pinging the author'}>
              <button
                type="button"
                aria-pressed={reply.ping}
                onClick={() => useUi.setState((s) => ({ replyingTo: { ...s.replyingTo, [key]: { ...reply, ping: !reply.ping } } }))}
                className={clsx('flex items-center gap-0.5 text-xs font-bold', reply.ping ? 'text-brand-sky' : 'text-fg-subtle')}
              >
                <AtSign className="h-4 w-4" />
                {reply.ping ? 'ON' : 'OFF'}
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={() => useUi.setState((s) => ({ replyingTo: { ...s.replyingTo, [key]: undefined } }))}
            className="text-fg-subtle hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {(attachmentIds.length > 0 || uploading) && (
        <div className="flex flex-wrap gap-2 bg-raised px-4 pt-3">
          {attachmentIds.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5 rounded-md bg-overlay px-2 py-1 text-xs text-fg">
              <FileUp className="h-3.5 w-3.5" />
              {a.name}
              <button aria-label={`Remove ${a.name}`} onClick={() => setAttachmentIds((l) => l.filter((x) => x.id !== a.id))} className="text-fg-subtle hover:text-danger">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {uploading && <span className="text-xs text-fg-subtle">Uploading {uploading}…</span>}
        </div>
      )}

      <div
        className={clsx('flex items-start gap-1 bg-raised px-3', reply || attachmentIds.length || uploading ? 'rounded-b-lg' : 'rounded-lg')}
        onDragOver={(e) => canAttach && e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => {
          if (!canAttach || !e.dataTransfer.files.length) return;
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
      >
        <Tooltip content="Upload a File">
          <button
            type="button"
            aria-label="Add attachment"
            disabled={!canAttach}
            onClick={(e) =>
              openContextMenu({ clientX: e.clientX, clientY: e.clientY - 8 }, [
                { label: 'Upload a File', icon: <FileUp className="h-4 w-4" />, onClick: () => fileInput.current?.click() },
                ...(encrypted ? [] : [{
                  label: 'Attach from Cloud Drive',
                  icon: <Cloud className="h-4 w-4" />,
                  onClick: () => openModal({ kind: 'drivePicker', onPick: (f) => setAttachmentIds((a) => [...a, { id: f.id, name: f.filename }]) }),
                }]),
                { label: 'Create Thread', disabled: true, sublabel: 'Coming soon' },
                { label: 'Use Apps', disabled: true, sublabel: 'Coming soon' },
              ])
            }
            className="mt-2.5 flex h-6 w-6 items-center justify-center rounded-full text-fg-muted hover:text-fg disabled:opacity-40"
          >
            <CirclePlus className="h-6 w-6" />
          </button>
        </Tooltip>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = '';
          }}
        />
        <RichInput
          ref={area}
          wrapperClassName="min-w-0 flex-1"
          value={text}
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={(v, caret) => {
            setText(v);
            setTrigger(findTrigger(v, caret));
            if (v) notifyTyping(key);
          }}
          onKeyDown={onKeyDown}
          onCaret={(caret) => setTrigger(findTrigger(text, caret))}
          onPasteFiles={(files) => {
            if (!canAttach) return false;
            void upload(files);
            return true;
          }}
          className="max-h-[50vh] min-h-[44px] px-1 py-[11px] text-[15px] leading-[22px]"
        />
        <div className="mt-2 flex items-center gap-1">
          <ComingSoon label="GIFs">
            <span className="flex h-7 w-7 items-center justify-center text-fg-muted"><GifIcon className="h-5 w-5" /></span>
          </ComingSoon>
          <ComingSoon label="Stickers">
            <span className="flex h-7 w-7 items-center justify-center text-fg-muted"><Sticker className="h-5 w-5" /></span>
          </ComingSoon>
          <Tooltip content="Select emoji">
            <button type="button" aria-label="Select emoji" onClick={(e) => setEmojiAnchor(e.currentTarget.getBoundingClientRect())} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg">
              <Smile className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {text.length > MAX_LENGTH - 200 && (
        <span className={clsx('absolute bottom-1 right-6 text-xs tabular-nums', over ? 'text-danger' : 'text-fg-subtle')}>
          {MAX_LENGTH - text.length}
        </span>
      )}

      {emojiAnchor && (
        <EmojiPicker
          anchor={emojiAnchor}
          beaconId={beaconId}
          placement="above"
          tabs
          onClose={() => setEmojiAnchor(null)}
          onPick={(emoji, glyph) => {
            insertAtCaret(glyph ? `<:${glyph.name}:${glyph.id}>` : emoji);
          }}
        />
      )}
    </div>
  );
}

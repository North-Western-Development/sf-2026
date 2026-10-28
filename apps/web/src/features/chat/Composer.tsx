import { Emoji } from '../../lib/emoji';
import { ScheduleButton } from '../schedule/ScheduleUI';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AtSign, Blocks, CirclePlus, Cloud, MessagesSquare, SendHorizontal, Smile, Sticker, X, FileUp, Hash, Vote } from 'lucide-react';
import { useA11yPrefs } from '../../lib/a11yPrefs';
import { Tooltip, useContextMenu } from '@subspace/ui';
import { useStore, getState } from '../../data/store';
import { notifyTyping, sendMessage, type SendOptions } from '../../data/actions';
import { relayPermissions, can, PERMISSIONS, myTimeout, verificationPending } from '../../data/permissions';
import { parseChannelKey, type ChannelKey, type UserRef } from '../../lib/types';
import { resolveName } from '../../lib/normalize';
import { useUi, toast, openModal } from '../../app/ui';
import { uploadToVault } from '../../lib/uploads';
import { VoiceRecorderButton } from './VoiceMessages';
import { sealFile } from '../../lib/e2ee/client';
import { isEncryptedChannel } from '../../data/e2ee';

type SealedAttachment = { url: string; key: string; filename: string; mimeType: string; size: number };
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { EmojiPicker, EMOJI_INDEX, loadGlyphs, type Glyph } from './EmojiPicker';
import { OnboardingGate, useNeedsOnboarding } from '../onboarding/OnboardingGate';
import { RichInput, type RichInputHandle } from '../common/RichInput';
import { matchCommands, parseCommand, type Command, type CommandContext } from './commands';
import { startThread, threadPath } from './ThreadParts';
import { createThread, useThreads } from './threads';
import { findAppCommand, matchAppCommands, missingRequired, parseOptions, runAppCommand, useAppCommands, type AppCommand } from './appCommands';
import { useNavigate } from 'react-router';

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
  const [pickerTab, setPickerTab] = useState<'gifs' | 'stickers' | 'emoji'>('emoji');
  const sendButton = useA11yPrefs((p) => p.sendButton);
  /** A sticker or GIF goes out on its own, as Discord sends them, replying if a reply is open. */
  const sendNow = (content: string, extra: SendOptions = {}) => {
    const r = useUi.getState().replyingTo[key];
    useUi.setState((s) => ({ replyingTo: { ...s.replyingTo, [key]: undefined } }));
    void sendMessage(key, content, { ...extra, replyToId: r?.messageId, replyPing: r?.ping });
  };
  const openPicker = (e: React.MouseEvent<HTMLElement>, tab: 'gifs' | 'stickers' | 'emoji') => {
    setPickerTab(tab);
    setEmojiAnchor(e.currentTarget.getBoundingClientRect());
  };
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
  const canSend = perms === null || can(perms, type === 'thread' ? PERMISSIONS.SEND_IN_THREADS : PERMISSIONS.SEND_TRANSMISSIONS);
  const canAttach = perms === null || can(perms, PERMISSIONS.ATTACH_FILES);
  const encryptedHere = useStore((s) => (type === 'link' && !!s.links[id]?.encryptedAt) || (type === 'mesh' && !!s.meshes[id]?.encryptedAt));
  // Polls and voice messages: their own permissions in a beacon; not in encrypted conversations.
  const canPoll = !encryptedHere && (perms === null || can(perms, PERMISSIONS.CREATE_POLLS));
  const canVoiceMessage = !encryptedHere && (perms === null || can(perms, PERMISSIONS.SEND_VOICE_MESSAGES));
  const canEveryone = perms === null ? false : can(perms, PERMISSIONS.MENTION_EVERYONE);
  const canAnyClearance = perms !== null && can(perms, PERMISSIONS.MENTION_CLEARANCES);
  const needsOnboarding = useNeedsOnboarding(type === 'relay' ? beaconId : undefined);
  const timedOutUntil = useStore((s) => (type === 'relay' && beaconId ? myTimeout(s, beaconId) : null));
  const verifying = useStore((s) => (type === 'relay' && beaconId ? verificationPending(s, beaconId) : null));
  // The time-based levels pass on their own; check again each minute while waiting.
  useEffect(() => {
    if (!verifying) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [verifying]);
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

  // A draft left for this channel while it is open (replying to someone's status from their profile).
  useEffect(() => {
    const onDraft = (e: Event) => {
      if ((e as CustomEvent<{ key: string }>).detail?.key !== key) return;
      setText(sessionStorage.getItem(`draft:${key}`) ?? '');
      area.current?.focus();
    };
    window.addEventListener('subspace:draft', onDraft);
    return () => window.removeEventListener('subspace:draft', onDraft);
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
            .filter((c) => c.position > 0 && (c.mentionable || canAnyClearance) && c.name.toLowerCase().includes(q))
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
  }, [trigger, type, id, beaconId, glyphs, canEveryone, canAnyClearance]);

  useEffect(() => setActive(0), [trigger?.query, trigger?.char]);

  /** The latest text, for callbacks that run a frame later. */
  const textNow = useRef(text);
  textNow.current = text;
  /** Put the caret at pos after the editor renders `expected`, unless typing got there first. */
  const caretAfterRender = (expected: string, pos: number) =>
    requestAnimationFrame(() => textNow.current === expected && area.current?.setCaret(pos));

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
    caretAfterRender(next, before.length + insert.length);
  };

  const insertAtCaret = (value: string) => area.current?.insert(value);

  // Built-in slash commands.
  const navigate = useNavigate();
  const threadRelay = useStore((s) => (type === 'relay' && s.relays[id]?.type === 'text' && can(relayPermissions(s, id), PERMISSIONS.CREATE_THREADS) ? s.relays[id] : undefined));
  const commandCtx: CommandContext = {
    beaconId,
    threadRelayId: threadRelay?.id,
    send: (content) => sendNow(content),
    startThread: async (name) => {
      if (!threadRelay) return;
      const t = await createThread(threadRelay.id, name);
      navigate(threadPath(threadRelay.beaconId, threadRelay.id, t.id));
    },
    toast,
  };
  // Bots' slash commands, beside the built-ins.
  const threadParent = useThreads((s) => (type === 'thread' ? s.byId[id]?.relayId : undefined));
  const appCommands = useAppCommands(type === 'relay' || type === 'thread' ? beaconId : undefined, type === 'relay' ? id : threadParent);
  const commandList: Array<{ kind: 'builtin'; c: Command } | { kind: 'app'; c: AppCommand }> = [
    ...matchCommands(text, commandCtx).map((c) => ({ kind: 'builtin' as const, c })),
    ...matchAppCommands(text, appCommands).map((c) => ({ kind: 'app' as const, c })),
  ];
  const typedApp = !commandList.length && !parseCommand(text, commandCtx) ? findAppCommand(text, appCommands) : null;
  const chooseCommand = ({ c }: { c: Command | AppCommand }) => {
    const next = `/${c.name} `;
    setText(next);
    caretAfterRender(next, next.length);
  };
  const showCommands = () => {
    setText('/');
    setActive(0);
    caretAfterRender('/', 1);
  };

  const submit = async () => {
    // A slash command runs instead of sending (Use Apps).
    const cmd = !attachmentIds.length ? parseCommand(text, commandCtx) : null;
    if (cmd) {
      setText('');
      await cmd.command.run(cmd.arg, commandCtx);
      return;
    }
    // A bot's command becomes an interaction; its answer arrives as an event.
    const appCmd = !attachmentIds.length && (type === 'relay' || type === 'thread') ? findAppCommand(text, appCommands) : null;
    if (appCmd) {
      const options = parseOptions(appCmd.command, encodeMentions(appCmd.rest, tokens.current));
      const missing = missingRequired(appCmd.command, options);
      if (missing.length) {
        toast(`/${appCmd.command.name} needs ${missing.map((o) => o.name).join(', ')}.`, 'error');
        return;
      }
      setText('');
      tokens.current.clear();
      await runAppCommand(type as 'relay' | 'thread', id, appCmd.command, options);
      return;
    }
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
    if (commandList.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + commandList.length) % commandList.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseCommand(commandList[Math.min(active, commandList.length - 1)]);
        return;
      }
    }
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
              : verifying ?? 'You do not have permission to transmit in this relay.')}</div>
      </div>
    );
  }

  const over = text.length > MAX_LENGTH;

  return (
    <div className="relative px-4 pb-6">
      {commandList.length > 0 && (
        <div role="listbox" aria-label="Commands" className="absolute inset-x-4 bottom-full mb-2 max-h-80 overflow-y-auto rounded-lg bg-overlay p-2 shadow-pop">
          {commandList.map(({ kind, c }, i) => (
            <div key={`${kind}:${'id' in c ? c.id : c.name}`}>
            {(i === 0 || commandList[i - 1].kind !== kind || (kind === 'app' && (commandList[i - 1].c as AppCommand).appId !== (c as AppCommand).appId)) && (
              <p className={clsx('flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle', i > 0 && 'pt-2')}>
                {kind === 'app' && (c as AppCommand).app.iconUrl && <img src={(c as AppCommand).app.iconUrl!} alt="" className="h-4 w-4 rounded-full" />}
                {kind === 'builtin' ? 'Built-in Apps' : (c as AppCommand).app.name}
              </p>
            )}
            <button
              role="option"
              aria-selected={i === active}
              type="button"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                chooseCommand({ c });
              }}
              className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === active ? 'bg-active' : '')}
            >
              <span className="font-semibold text-fg">/{c.name}</span>
              {'arg' in c && c.arg && <span className="rounded bg-raised px-1 text-xs text-fg-muted">{c.arg}</span>}
              {'options' in c &&
                c.options.map((o) => (
                  <span key={o.name} className="rounded bg-raised px-1 text-xs text-fg-muted">
                    {o.name}
                    {o.required ? '' : '?'}
                  </span>
                ))}
              <span className="min-w-0 flex-1 truncate text-fg-subtle">{c.description}</span>
            </button>
            </div>
          ))}
        </div>
      )}
      {typedApp && typedApp.command.options.length > 0 && (
        <div aria-label="Command options" className="absolute inset-x-4 bottom-full mb-2 rounded-lg bg-overlay p-3 text-sm shadow-pop">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            /{typedApp.command.name} · {typedApp.command.app.name}
          </p>
          <ul className="space-y-0.5">
            {typedApp.command.options.map((o) => {
              const given = parseOptions(typedApp.command, typedApp.rest)[o.name];
              return (
                <li key={o.name} className="flex gap-2">
                  <code className={clsx('rounded px-1', given ? 'bg-active text-fg' : 'bg-raised text-fg-muted')}>
                    {o.name}:{o.choices?.length ? o.choices.map((ch) => ch.value).join('|') : o.type}
                  </code>
                  <span className="min-w-0 flex-1 truncate text-fg-subtle">
                    {o.description}
                    {o.required && <span className="text-danger"> · required</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {typedApp.command.options.length > 1 && <p className="mt-1 text-xs text-fg-subtle">Type option:value for each, e.g. {typedApp.command.options[0].name}:…</p>}
        </div>
      )}
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
                ...(threadRelay ? [{ label: 'Create Thread', icon: <MessagesSquare className="h-4 w-4" />, onClick: () => startThread(threadRelay, navigate) }] : []),
                ...(canPoll ? [{ label: 'Create Poll', icon: <Vote className="h-4 w-4" />, onClick: () => openModal({ kind: 'createPoll', channelKey: key }) }] : []),
                { label: 'Use Apps', icon: <Blocks className="h-4 w-4" />, onClick: () => showCommands() },
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
          {!encrypted && (
            <>
              <Tooltip content="Open GIF picker">
                <button type="button" aria-label="Open GIF picker" onClick={(e) => openPicker(e, 'gifs')} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg">
                  <GifIcon className="h-5 w-5" />
                </button>
              </Tooltip>
              <Tooltip content="Open sticker picker">
                <button type="button" aria-label="Open sticker picker" onClick={(e) => openPicker(e, 'stickers')} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg">
                  <Sticker className="h-5 w-5" />
                </button>
              </Tooltip>
            </>
          )}
          <Tooltip content="Select emoji">
            <button type="button" aria-label="Select emoji" onClick={(e) => openPicker(e, 'emoji')} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg">
              <Smile className="h-5 w-5" />
            </button>
          </Tooltip>
          {canVoiceMessage && !text.trim() && !attachmentIds.length && <VoiceRecorderButton channelKey={key} />}
          {/* Text only: files are uploaded now, so they could not wait for later. */}
          {text.trim() && !attachmentIds.length && !text.trim().startsWith('/') && (
            <ScheduleButton
              channelKey={key}
              text={encodeMentions(text, tokens.current)}
              onScheduled={() => {
                setText('');
                tokens.current.clear();
              }}
            />
          )}
          {sendButton && (
            <Tooltip content="Send">
              <button type="button" aria-label="Send" onClick={() => void submit()} disabled={!text.trim() && !attachmentIds.length} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg disabled:opacity-40">
                <SendHorizontal className="h-5 w-5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {type === 'relay' && <SlowmodeNotice channelKey={key} relayId={id} />}

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
          initialTab={pickerTab}
          onSticker={encrypted ? undefined : (s) => sendNow('', { stickerIds: [s.id], stickers: [{ id: s.id, name: s.name, url: s.url }] })}
          onGif={encrypted ? undefined : (g) => sendNow(g.url)}
          onClose={() => setEmojiAnchor(null)}
          onPick={(emoji, glyph) => {
            insertAtCaret(glyph ? `<:${glyph.name}:${glyph.id}>` : emoji);
          }}
        />
      )}
    </div>
  );
}

/** Under the box in a slowmode relay: that it is on, and how long until I can send again. */
function SlowmodeNotice({ channelKey: key, relayId }: { channelKey: string; relayId: string }) {
  const seconds = useStore((s) => s.relays[relayId]?.slowmodeSeconds ?? 0);
  const bypass = useStore((s) => can(relayPermissions(s, relayId), PERMISSIONS.BYPASS_SLOWMODE));
  const until = useUi((u) => u.slowmodeUntil[key] ?? 0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  if (!seconds) return null;
  const left = Math.ceil((until - now) / 1000);
  return (
    <span role="status" aria-label="Slowmode" className="absolute bottom-1 left-6 text-xs text-fg-subtle">
      {bypass ? 'Slowmode is on (you are exempt)' : left > 0 ? `Slowmode: you can send again in ${left}s` : `Slowmode is on: one transmission every ${seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`}`}
    </span>
  );
}

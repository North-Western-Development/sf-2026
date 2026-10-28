import { useEffect, useState } from 'react';
import { http } from '../../lib/http';
import { toTransmission, toUserRef } from '../../lib/normalize';
import { channelKey, type ChannelKey, type Transmission } from '../../lib/types';
import { getState, removeMessage, upsertMessages } from '../../data/store';
import { toast } from '../../app/ui';

/**
 * Slash commands registered by the bots in a beacon. Typing "/" lists them beside the built-ins;
 * sending one posts an interaction instead of a message, and the bot's answer arrives as an event
 * (a message everyone sees, or an ephemeral one only you see).
 */
export interface AppCommandOption {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'relay' | 'clearance';
  name: string;
  description: string;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
}

export interface AppCommand {
  id: string;
  appId: string;
  name: string;
  description: string;
  options: AppCommandOption[];
  app: { id: string; name: string; iconUrl: string | null; botUserId: string };
}

const cache = new Map<string, { at: number; commands: AppCommand[] }>();

/** The app commands usable here; refreshed when older than a minute. */
export function useAppCommands(beaconId: string | undefined, relayId: string | undefined): AppCommand[] {
  const cacheKey = beaconId ? `${beaconId}:${relayId ?? ''}` : '';
  const [commands, setCommands] = useState<AppCommand[]>(() => cache.get(cacheKey)?.commands ?? []);
  useEffect(() => {
    if (!beaconId) return setCommands([]);
    const hit = cache.get(cacheKey);
    setCommands(hit?.commands ?? []);
    if (hit && Date.now() - hit.at < 60_000) return;
    let live = true;
    const q = relayId ? `?relayId=${relayId}` : '';
    http
      .get<{ commands: AppCommand[] }>(`/beacons/${beaconId}/commands${q}`)
      .then((r) => {
        cache.set(cacheKey, { at: Date.now(), commands: r.commands });
        if (live) setCommands(r.commands);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [beaconId, relayId, cacheKey]);
  return commands;
}

/** Forget cached commands (a bot was added or removed). */
export const invalidateAppCommands = () => cache.clear();

/** "/name rest" → the app command it names. */
export function findAppCommand(text: string, commands: AppCommand[]): { command: AppCommand; rest: string } | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const command = commands.find((c) => c.name === m[1].toLowerCase());
  return command ? { command, rest: m[2] ?? '' } : null;
}

/** App commands to suggest while the box holds "/partial". */
export function matchAppCommands(text: string, commands: AppCommand[]): AppCommand[] {
  const m = /^\/([\w-]*)$/.exec(text);
  if (!m) return [];
  return commands.filter((c) => c.name.startsWith(m[1].toLowerCase()));
}

/**
 * Option values from what follows the name: `name:value` pairs (a value runs to the next known
 * `option:`), or, for a command with one option, the whole text.
 */
export function parseOptions(command: AppCommand, rest: string): Record<string, string> {
  const text = rest.trim();
  if (!text || !command.options.length) return {};
  const names = command.options.map((o) => o.name);
  const marker = new RegExp(`(?:^|\\s)(${names.map((n) => n.replace(/[-]/g, '\\-')).join('|')}):`, 'g');
  const hits = [...text.matchAll(marker)];
  if (!hits.length) {
    const only = command.options.length === 1 ? command.options[0] : command.options.find((o) => o.required) ?? command.options[0];
    return { [only.name]: text };
  }
  const out: Record<string, string> = {};
  hits.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index! : text.length;
    out[h[1]] = text.slice(start, end).trim();
  });
  return out;
}

/** The options still missing from what was typed (required ones first). */
export function missingRequired(command: AppCommand, given: Record<string, string>) {
  return command.options.filter((o) => o.required && !given[o.name]);
}

// Interactions this client started, so "thinking" can show the bot.
const started = new Map<string, { key: ChannelKey; botUserId: string; appName: string }>();

export async function runAppCommand(type: 'relay' | 'thread', channelId: string, command: AppCommand, options: Record<string, string>) {
  try {
    const r = await http.post<{ interaction: { id: string } }>('/interactions', { commandId: command.id, channelType: type, channelId, options });
    started.set(r.interaction.id, { key: channelKey(type, channelId), botUserId: command.app.botUserId, appName: command.app.name });
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

const thinkingId = (interactionId: string) => `thinking-${interactionId}`;
const thinking = new Map<string, { key: ChannelKey; botUserId: string; id: string }>();

function botRef(botUserId: string) {
  const s = getState();
  for (const members of Object.values(s.members)) {
    const m = members?.[botUserId];
    if (m) return m.user;
  }
  return toUserRef({ id: botUserId, username: 'App', botKind: 'bot' });
}

/** INTERACTION_EPHEMERAL: an answer only you see; it lives on this device until dismissed. */
export function onInteractionEphemeral(d: any) {
  if (!d?.transmission) return;
  const key = channelKey(d.channelType, d.channelId);
  clearThinking(d.interactionId);
  upsertMessages(key, [{ ...toTransmission(d.transmission), channelType: d.channelType, channelId: d.channelId, ephemeral: true }]);
}

/** INTERACTION_DEFERRED: "<bot> is thinking…" until the answer arrives. */
export function onInteractionDeferred(d: any) {
  const key = channelKey(d.channelType, d.channelId);
  const id = thinkingId(d.interactionId);
  const author = botRef(d.appUserId);
  const me = getState().me;
  const msg: Transmission = {
    ...toTransmission({ id, author, content: '', createdAt: new Date().toISOString() }),
    channelType: d.channelType,
    channelId: d.channelId,
    ephemeral: true,
    thinking: true,
    interaction: { name: d.command, user: me ? toUserRef(me) : null },
  };
  thinking.set(d.interactionId, { key, botUserId: d.appUserId, id });
  upsertMessages(key, [msg]);
  // A bot that never follows up: drop the placeholder when the interaction expires.
  setTimeout(() => clearThinking(d.interactionId), 15 * 60_000);
}

/** INTERACTION_FAILED: the bot did not answer in time. */
export function onInteractionFailed(d: any) {
  clearThinking(d.interactionId);
  const app = started.get(d.interactionId)?.appName;
  started.delete(d.interactionId);
  toast(app ? `${app} did not respond.` : 'The application did not respond.', 'error');
}

function clearThinking(interactionId: string) {
  const t = thinking.get(interactionId);
  if (!t) return;
  thinking.delete(interactionId);
  removeMessage(t.key, t.id);
}

/** A message arrived: if it is a bot's answer to a command we are waiting on, stop "thinking". */
export function settleThinking(key: ChannelKey, t: Transmission) {
  if (!t.interaction) return;
  for (const [interactionId, w] of thinking) if (w.key === key && w.botUserId === t.author.id) return clearThinking(interactionId);
}

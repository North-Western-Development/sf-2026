// Activity status: what I am playing, from the desktop app, shared over the gateway as my
// Activity Privacy allows. Nothing here is stored on the server; the per-game choices and the
// list of games seen stay on this device.
import { create } from 'zustand';
import { isInstanceImage, sameActivity, sanitizeActivity, steamCoverOf, type Activity, type ActivityVisibility } from '@subspace/constants';
import { gateway } from '../../services/gateway';
import { http } from '../../lib/http';
import { getState, setState, useStore } from '../../data/store';

/** What the desktop app reports (apps/desktop/src-tauri/src/activity.rs). */
export interface NativeActivity {
  /** A known game running on this PC. */
  detected: { name: string; startedAt: number } | null;
  /** Rich Presence from a game or app talking to the local RPC server. */
  rpc: { clientId: string; activity: Record<string, unknown> } | null;
}

interface SeenGame {
  name: string;
  lastSeen: number;
}

interface ActivityState {
  native: NativeActivity | null;
  /** Game names not to share (Activity Privacy › per game). */
  hidden: string[];
  /** Games found on this device, newest first, for the settings list. */
  seen: SeenGame[];
}

const HIDDEN_KEY = 'subspace_activity_hidden';
const SEEN_KEY = 'subspace_activity_seen';
const MAX_SEEN = 30;

const readList = <T,>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const writeList = (key: string, value: unknown[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window: the choice lasts this session */
  }
};

export const useActivity = create<ActivityState>(() => ({ native: null, hidden: readList<string>(HIDDEN_KEY), seen: readList<SeenGame>(SEEN_KEY) }));

/** Whether this window is the desktop app, which is the only place games are found. */
export const canDetectGames = () => !!(window as unknown as { subspaceDesktop?: boolean }).subspaceDesktop;

export function setGameHidden(name: string, hidden: boolean) {
  const list = useActivity.getState().hidden.filter((n) => n !== name);
  if (hidden) list.push(name);
  writeList(HIDDEN_KEY, list);
  useActivity.setState({ hidden: list });
  void publish();
}

export function forgetGame(name: string) {
  const seen = useActivity.getState().seen.filter((g) => g.name !== name);
  writeList(SEEN_KEY, seen);
  useActivity.setState({ seen });
}

/** Save Activity Privacy on the account; the gateway starts or stops sharing straight away. */
export async function setActivityVisibility(activityVisibility: ActivityVisibility) {
  const me = getState().me;
  if (!me) return;
  const prev = (me as { activityVisibility?: ActivityVisibility }).activityVisibility;
  setState({ me: { ...me, activityVisibility } as typeof me });
  try {
    await http.patch('/users/@me/profile', { activityVisibility });
  } catch (err) {
    setState({ me: { ...getState().me!, activityVisibility: prev } as typeof me });
    throw err;
  }
  void publish();
}

export const visibilityOf = (me: unknown): ActivityVisibility => (me as { activityVisibility?: ActivityVisibility } | null)?.activityVisibility ?? 'off';

// --- Rich Presence: the application's name, and images through the media proxy ---------------

const apps = new Map<string, Promise<{ name: string; iconUrl: string | null } | null>>();
const appInfo = (id: string) => {
  if (!apps.has(id)) {
    apps.set(
      id,
      http.get<{ application: { name: string; iconUrl: string | null } }>(`/oauth2/applications/${id}`).then(
        (r) => r.application,
        () => null
      )
    );
  }
  return apps.get(id)!;
};

type VerifiedGames = Record<string, { applicationId: string; iconUrl: string | null }>;
let verified: { at: number; games: Promise<VerifiedGames> } | null = null;
/** Games staff linked to their developer's application (Command Console › Verified Games). */
function verifiedGames() {
  if (!verified || Date.now() - verified.at > 10 * 60_000) {
    verified = { at: Date.now(), games: http.get<{ games: VerifiedGames }>('/oauth2/verified-games').then((r) => r.games, () => ({})) };
  }
  return verified.games;
}

const proxies = new Map<string, string>();
async function proxyImages(urls: string[]) {
  const missing = [...new Set(urls)].filter((u) => !proxies.has(u));
  if (!missing.length) return;
  try {
    const r = await http.post<{ proxied: Record<string, string> }>('/embed-proxy/sign', { urls: missing.slice(0, 8) });
    for (const [url, path] of Object.entries(r.proxied)) proxies.set(url, path);
  } catch {
    /* shown without the image */
  }
}

/** The activity to share from what the desktop app reports, or null. */
async function build(native: NativeActivity | null, hidden: string[]): Promise<Activity | null> {
  if (native?.rpc && /^[1-9][0-9]{0,18}$/.test(native.rpc.clientId)) {
    const app = await appInfo(native.rpc.clientId);
    if (app && !hidden.includes(app.name)) {
      const raw = { ...native.rpc.activity, name: app.name, applicationId: native.rpc.clientId, source: 'rpc' };
      const first = sanitizeActivity(raw);
      if (first) {
        const external = [first.largeImage, first.smallImage].filter((u): u is string => !!u && !isInstanceImage(u));
        await proxyImages(external);
        const swap = (u?: string) => (u ? (isInstanceImage(u) ? u : proxies.get(u)) : undefined);
        // Without its own art, the application's icon stands in.
        return sanitizeActivity({ ...first, largeImage: swap(first.largeImage) ?? app.iconUrl ?? undefined, smallImage: swap(first.smallImage) });
      }
    }
  }
  const game = native?.detected;
  if (!game || hidden.includes(game.name)) return null;
  const detected = { type: 'playing', name: game.name, startedAt: game.startedAt, source: 'detected' } as const;
  // The game's own application, when staff verified one with an icon; else its Steam cover.
  const verified = (await verifiedGames())[game.name];
  if (verified?.iconUrl) return sanitizeActivity({ ...detected, applicationId: verified.applicationId, largeImage: verified.iconUrl, largeText: game.name });
  const cover = steamCoverOf(game.name);
  if (cover) await proxyImages([cover]);
  const proxied = cover && proxies.get(cover);
  return sanitizeActivity({ ...detected, largeImage: proxied, largeText: proxied && game.name });
}

let sent: Activity | null = null;
let run = 0;

/** Work out what to share and hand it to the gateway (which applies Activity Privacy too). */
async function publish() {
  const id = ++run;
  const { native, hidden } = useActivity.getState();
  const off = visibilityOf(getState().me) === 'off';
  const next = off ? null : await build(native, hidden);
  if (id !== run || sameActivity(sent, next)) return;
  sent = next;
  gateway.updateActivity(next);
}

function remember(name: string) {
  const seen = [{ name, lastSeen: Date.now() }, ...useActivity.getState().seen.filter((g) => g.name !== name)].slice(0, MAX_SEEN);
  writeList(SEEN_KEY, seen);
  useActivity.setState({ seen });
}

function onNative(detail: NativeActivity | null) {
  const prev = useActivity.getState().native;
  useActivity.setState({ native: detail });
  if (detail?.detected && detail.detected.name !== prev?.detected?.name) remember(detail.detected.name);
  void publish();
}

/** Listen to the desktop app and share what it reports. Returns the cleanup. */
export function startActivitySharing(): () => void {
  const w = window as unknown as { __subspaceActivity?: NativeActivity };
  const listener = (e: Event) => onNative((e as CustomEvent<NativeActivity>).detail ?? null);
  window.addEventListener('subspace:activity', listener);
  // The desktop app may have reported before this listener existed.
  if (w.__subspaceActivity) onNative(w.__subspaceActivity);
  // Turning Activity Privacy on or off (here or on another device) re-evaluates what to send.
  const offMe = useStore.subscribe((s, p) => {
    if (visibilityOf(s.me) !== visibilityOf(p.me)) void publish();
  });
  return () => {
    window.removeEventListener('subspace:activity', listener);
    offMe();
  };
}

/** "Playing", "Listening to"...: the verb before the name. */
export const ACTIVITY_VERBS: Record<Activity['type'], string> = {
  playing: 'Playing',
  streaming: 'Streaming',
  listening: 'Listening to',
  watching: 'Watching',
  competing: 'Competing in',
};

/** "42m", "1h 5m": how long since startedAt. */
export function elapsed(since: number, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - since) / 60_000));
  if (mins < 1) return 'just now';
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/** "3:05 left" until endsAt. */
export function remaining(until: number, now = Date.now()) {
  const secs = Math.max(0, Math.floor((until - now) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s} left` : `${m}:${s} left`;
}

/** Images other people's activities may show: only this instance's media proxy. */
export const safeActivityImage = (url?: string) => (url && isInstanceImage(url) ? url : undefined);

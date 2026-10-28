import { create } from 'zustand';
import { http, optional } from '../../lib/http';
import { toast } from '../../app/ui';
import { useVoice } from './session';
import { useStore } from '../../data/store';

export type BuiltinKind = 'watch' | 'whiteboard';
/** 'app': a developer's custom Activity (CustomActivity.tsx). */
export type ActivityKind = BuiltinKind | 'app';

export const ACTIVITY_INFO: Record<BuiltinKind, { name: string; blurb: string }> = {
  watch: { name: 'Watch Together', blurb: 'Watch a YouTube video or a video file in sync.' },
  whiteboard: { name: 'Whiteboard', blurb: 'Draw together on a shared board.' },
};

/** Which application a custom Activity is (what the launcher and the privacy notice show). */
export interface ActivityApp {
  id: string;
  name: string;
  description?: string | null;
  iconUrl: string | null;
  /** Its team's name, or its owner's username. */
  developer: string;
  /** Where it runs (scheme://host:port). */
  origin: string;
  /** False: only its team can see it, for testing. */
  approved: boolean;
  maxParticipants?: number;
}

/** A participant's public profile, as a custom Activity sees it. */
export interface ActivityPerson {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** What anyone who can see the comm-link knows about its activity. */
export interface ActivitySummary {
  id: string;
  kind: ActivityKind;
  hostId: string;
  startedAt: string;
  count: number;
  /** Participants who share their activity (Privacy Settings). */
  participants: string[];
  app?: ActivityApp;
}

/** The activity I am in, in full. */
export interface Activity extends ActivitySummary {
  relayId: string;
  beaconId?: string;
  watch?: WatchState;
  /** A custom Activity: also the page to load (only ever this URL, from our API). */
  app?: ActivityApp & { url?: string };
  /** A custom Activity: everyone in it. */
  people?: ActivityPerson[];
}

export const activityName = (a: { kind: ActivityKind; app?: { name: string } }) => (a.kind === 'app' ? (a.app?.name ?? 'Activity') : ACTIVITY_INFO[a.kind].name);

// ---------------------------------------------------------------------------
// The privacy notice before a custom Activity loads (once per app and origin, per account, on this device)
// ---------------------------------------------------------------------------

const CONSENT_KEY = 'subspace_activity_consent';
const consentId = (meId: string, app: Pick<ActivityApp, 'id' | 'origin'>) => `${meId}:${app.id}:${app.origin}`;

function consents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CONSENT_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const hasActivityConsent = (meId: string, app: Pick<ActivityApp, 'id' | 'origin'>) => consents().includes(consentId(meId, app));

export function rememberActivityConsent(meId: string, app: Pick<ActivityApp, 'id' | 'origin'>) {
  try {
    const list = consents().filter((c) => c !== consentId(meId, app));
    localStorage.setItem(CONSENT_KEY, JSON.stringify([...list, consentId(meId, app)].slice(-200)));
  } catch {
    /* private mode: they are asked again next time */
  }
}

/** Prompts a custom Activity can raise, shown by <ActivityPrompts /> (in ModalHost). */
export type ActivityPrompt =
  | { kind: 'notice'; app: ActivityApp; resolve: (ok: boolean) => void }
  | { kind: 'authorize'; app: ActivityApp; scopes: string[]; resolve: (ok: boolean) => void };

export const useActivityPrompt = create<{ prompt: ActivityPrompt | null }>()(() => ({ prompt: null }));

type PromptInput = { kind: 'notice'; app: ActivityApp } | { kind: 'authorize'; app: ActivityApp; scopes: string[] };

function ask(prompt: PromptInput): Promise<boolean> {
  return new Promise((resolve) => {
    // A newer prompt replaces an older one, which counts as cancelled.
    useActivityPrompt.getState().prompt?.resolve(false);
    useActivityPrompt.setState({ prompt: { ...prompt, resolve } as ActivityPrompt });
  });
}

/** Ask before a third party's page loads, unless they already agreed for this app and origin. */
export async function ensureActivityConsent(meId: string, app: ActivityApp): Promise<boolean> {
  if (hasActivityConsent(meId, app)) return true;
  const ok = await ask({ kind: 'notice', app });
  if (ok) rememberActivityConsent(meId, app);
  return ok;
}

/** sdk.authorize(): the in-app OAuth2 consent prompt. */
export const askActivityAuthorization = (app: ActivityApp, scopes: string[]) => ask({ kind: 'authorize', app, scopes });

/** Custom Activities I may launch: approved ones, and my own apps' to test. */
export const loadActivityApps = () => optional(http.get<{ activities: ActivityApp[] }>('/activities/apps'), { activities: [] }).then((r) => r.activities);

export interface WatchState {
  url: string;
  playing: boolean;
  position: number;
  /** When `position` was true (ms since epoch). */
  at: number;
  by?: string;
}

export interface Stroke {
  id: string;
  points: number[];
  color: string;
  width: number;
  by: string;
}

interface ActivityStore {
  /** Every running activity in each comm-link I can see, oldest first. */
  byRelay: Record<string, ActivitySummary[]>;
  /** The activity I joined, or null. */
  mine: Activity | null;
}

export const useActivities = create<ActivityStore>()(() => ({ byRelay: {}, mine: null }));

type Listener = (type: string, data: any) => void;
const listeners = new Set<Listener>();
/** Whiteboard and Watch Together listen for each other's events here. */
export function onActivityEvent(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function loadActivities(relayId: string) {
  const res = await optional(http.get<{ activities: (Activity | ActivitySummary)[] }>(`/relays/${relayId}/activities`), { activities: [] });
  useActivities.setState((s) => ({ byRelay: { ...s.byRelay, [relayId]: res.activities } }));
  return res.activities;
}

const fail = (err: unknown) => toast((err as Error).message, 'error');

/**
 * The gateway records that we are in the comm-link a moment after the call connects, so right
 * after joining the API may not know yet: retry that one refusal for a few seconds.
 */
async function inCommLink<T>(run: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (err) {
      if ((err as { code?: string }).code !== 'NOT_IN_COMM_LINK' || i >= 20) throw err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

const base = (a: { relayId: string; id: string }) => `/relays/${a.relayId}/activities/${a.id}`;

/** A custom Activity's privacy notice, before starting or joining it. */
async function consentFor(app: ActivityApp | undefined) {
  const meId = useStore.getState().me?.id;
  return !app || !meId || ensureActivityConsent(meId, app);
}

export async function startActivity(relayId: string, kind: ActivityKind, url?: string, app?: ActivityApp) {
  if (kind === 'app' && !(app && (await consentFor(app)))) return false;
  try {
    const body = { kind, ...(url ? { url } : {}), ...(kind === 'app' && app ? { appId: app.id } : {}) };
    const { activity } = await inCommLink(() => http.post<{ activity: Activity }>(`/relays/${relayId}/activities`, body));
    useActivities.setState({ mine: { ...activity, relayId } });
    upsert(relayId, activity);
    return true;
  } catch (err) {
    fail(err);
    return false;
  }
}

export async function joinActivity(relayId: string, activityId: string, app?: ActivityApp) {
  const known = app ?? useActivities.getState().byRelay[relayId]?.find((a) => a.id === activityId)?.app;
  if (known && !(await consentFor(known))) return;
  try {
    const { activity } = await inCommLink(() => http.post<{ activity: Activity }>(`${base({ relayId, id: activityId })}/join`));
    useActivities.setState({ mine: { ...activity, relayId } });
  } catch (err) {
    fail(err);
  }
}

export async function leaveActivity() {
  const mine = useActivities.getState().mine;
  if (!mine) return;
  useActivities.setState({ mine: null });
  await http.post(`${base(mine)}/leave`).catch(() => {});
}

/** sdk.broadcast(): to the others in my custom Activity. Rejects with the API's refusal. */
export function broadcastActivityMessage(payload: unknown) {
  const mine = useActivities.getState().mine;
  if (!mine || mine.kind !== 'app') return Promise.reject(Object.assign(new Error('Not in a custom activity'), { code: 'NOT_IN_ACTIVITY' }));
  return http.post(`${base(mine)}/events`, { type: 'message', data: { payload } });
}

/** sdk.authorize(): an OAuth2 code for my custom Activity's app. */
export function authorizeActivity(scopes: string[], consent: boolean) {
  const mine = useActivities.getState().mine;
  if (!mine || mine.kind !== 'app') return Promise.reject(Object.assign(new Error('Not in a custom activity'), { code: 'NOT_IN_ACTIVITY' }));
  return http.post<{ code: string; scopes: string[] }>(`${base(mine)}/authorize`, { scopes, consent });
}

export function sendActivityEvent(type: 'stroke' | 'clear' | 'watch', data: Record<string, unknown> = {}) {
  const mine = useActivities.getState().mine;
  if (!mine) return Promise.resolve();
  return http.post(`${base(mine)}/events`, { type, data }).catch(() => {});
}

export const loadStrokes = (relayId: string, activityId: string) =>
  http.get<{ strokes: Stroke[] }>(`${base({ relayId, id: activityId })}/strokes`).then((r) => r.strokes, () => []);

function upsert(relayId: string, activity: ActivitySummary) {
  useActivities.setState((s) => {
    const list = s.byRelay[relayId] ?? [];
    const next = list.some((a) => a.id === activity.id) ? list.map((a) => (a.id === activity.id ? activity : a)) : [...list, activity];
    return { byRelay: { ...s.byRelay, [relayId]: next } };
  });
}

/** ACTIVITY_UPDATE: an activity started, changed hands or ended in a comm-link I can see. */
export function onActivityUpdate(d: { relayId: string; activityId: string; activity: ActivitySummary | null }) {
  if (d.activity) upsert(d.relayId, d.activity);
  else useActivities.setState((s) => ({ byRelay: { ...s.byRelay, [d.relayId]: (s.byRelay[d.relayId] ?? []).filter((a) => a.id !== d.activityId) } }));
  useActivities.setState((s) => {
    if (s.mine?.id !== d.activityId) return {};
    if (!d.activity) return { mine: null };
    // The summary has no page URL and names only who shares their activity: keep what I know in full.
    return { mine: { ...s.mine, ...d.activity, relayId: d.relayId, participants: s.mine.participants, app: s.mine.app && { ...s.mine.app, ...d.activity.app } } };
  });
}

/** ACTIVITY_EVENT: a stroke, a clear, or a Watch Together change from someone in my activity. */
export function onActivityEventMessage(d: { relayId: string; activityId: string; event: string; data: any }) {
  const mine = useActivities.getState().mine;
  if (!mine || mine.id !== d.activityId) return;
  if (d.event === 'watch') useActivities.setState({ mine: { ...mine, watch: d.data } });
  if (d.event === 'participants') useActivities.setState({ mine: { ...mine, hostId: d.data.hostId, participants: d.data.participants, people: d.data.people, count: d.data.participants.length } });
  listeners.forEach((fn) => fn(d.event, d.data));
}

type MessageListener = (m: { from: string; payload: unknown }) => void;
const messageListeners = new Set<MessageListener>();
/** sdk.on('message'): broadcasts from the others in my custom Activity. */
export function onActivityMessage(fn: MessageListener) {
  messageListeners.add(fn);
  return () => {
    messageListeners.delete(fn);
  };
}

/** ACTIVITY_MESSAGE: someone in my custom Activity broadcast something. */
export function onActivityMessageEvent(d: { activityId: string; from: string; payload: unknown }) {
  if (useActivities.getState().mine?.id !== d.activityId) return;
  messageListeners.forEach((fn) => fn({ from: d.from, payload: d.payload }));
}

// Leaving the comm-link leaves its activity.
useVoice.subscribe((v, prev) => {
  const mine = useActivities.getState().mine;
  if (mine && prev.relayId === mine.relayId && v.relayId !== mine.relayId) void leaveActivity();
});

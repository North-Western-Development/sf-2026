import { create } from 'zustand';
import { http, optional } from '../../lib/http';
import { toast } from '../../app/ui';
import { useVoice } from './session';

export type ActivityKind = 'watch' | 'whiteboard';

export const ACTIVITY_INFO: Record<ActivityKind, { name: string; blurb: string }> = {
  watch: { name: 'Watch Together', blurb: 'Watch a YouTube video or a video file in sync.' },
  whiteboard: { name: 'Whiteboard', blurb: 'Draw together on a shared board.' },
};

/** What anyone who can see the comm-link knows about its activity. */
export interface ActivitySummary {
  id: string;
  kind: ActivityKind;
  hostId: string;
  startedAt: string;
  count: number;
  /** Participants who share their activity (Privacy Settings). */
  participants: string[];
}

/** The activity I am in, in full. */
export interface Activity extends ActivitySummary {
  relayId: string;
  watch?: WatchState;
}

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
  byRelay: Record<string, ActivitySummary | null>;
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

export async function loadActivity(relayId: string) {
  const res = await optional(http.get<{ activity: Activity | ActivitySummary | null }>(`/relays/${relayId}/activity`), { activity: null });
  useActivities.setState((s) => ({ byRelay: { ...s.byRelay, [relayId]: res.activity } }));
  return res.activity;
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

export async function startActivity(relayId: string, kind: ActivityKind, url?: string) {
  try {
    const { activity } = await inCommLink(() => http.post<{ activity: Activity }>(`/relays/${relayId}/activity`, { kind, ...(url ? { url } : {}) }));
    useActivities.setState((s) => ({ mine: { ...activity, relayId }, byRelay: { ...s.byRelay, [relayId]: activity } }));
    return true;
  } catch (err) {
    fail(err);
    return false;
  }
}

export async function joinActivity(relayId: string) {
  try {
    const { activity } = await inCommLink(() => http.post<{ activity: Activity }>(`/relays/${relayId}/activity/join`));
    useActivities.setState({ mine: { ...activity, relayId } });
  } catch (err) {
    fail(err);
  }
}

export async function leaveActivity() {
  const mine = useActivities.getState().mine;
  if (!mine) return;
  useActivities.setState({ mine: null });
  await http.post(`/relays/${mine.relayId}/activity/leave`).catch(() => {});
}

export function sendActivityEvent(type: 'stroke' | 'clear' | 'watch', data: Record<string, unknown> = {}) {
  const mine = useActivities.getState().mine;
  if (!mine) return Promise.resolve();
  return http.post(`/relays/${mine.relayId}/activity/events`, { type, data }).catch(() => {});
}

export const loadStrokes = (relayId: string) => http.get<{ strokes: Stroke[] }>(`/relays/${relayId}/activity/strokes`).then((r) => r.strokes, () => []);

/** ACTIVITY_UPDATE: an activity started, changed hands or ended in a comm-link I can see. */
export function onActivityUpdate(d: { relayId: string; activity: ActivitySummary | null }) {
  useActivities.setState((s) => {
    const mine = s.mine?.relayId === d.relayId ? (d.activity ? { ...s.mine, ...d.activity, relayId: d.relayId } : null) : s.mine;
    return { byRelay: { ...s.byRelay, [d.relayId]: d.activity }, mine };
  });
}

/** ACTIVITY_EVENT: a stroke, a clear, or a Watch Together change from someone in my activity. */
export function onActivityEventMessage(d: { relayId: string; event: string; data: any }) {
  const mine = useActivities.getState().mine;
  if (!mine || mine.relayId !== d.relayId) return;
  if (d.event === 'watch') useActivities.setState({ mine: { ...mine, watch: d.data } });
  listeners.forEach((fn) => fn(d.event, d.data));
}

// Leaving the comm-link leaves its activity.
useVoice.subscribe((v, prev) => {
  const mine = useActivities.getState().mine;
  if (mine && prev.relayId === mine.relayId && v.relayId !== mine.relayId) void leaveActivity();
});

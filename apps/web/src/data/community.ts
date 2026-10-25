import { create } from 'zustand';
import { http, optional } from '../lib/http';
import type { UserRef } from '../lib/types';

/**
 * Per-beacon community data: which relays I hide from my sidebar (Browse Channels), my
 * onboarding answers, and the beacon's scheduled events. Kept apart from the main store
 * because only a few screens read it.
 */

export interface RelayPrefs {
  hiddenRelayIds: string[];
  selectedOptionIds: string[];
  /** relayId -> last transmission time (ISO). */
  activity: Record<string, string>;
}

export type Recurrence = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'weekdays';

export interface BeaconEvent {
  id: string;
  beaconId: string;
  name: string;
  description: string | null;
  locationType: 'comm_link' | 'stage' | 'external';
  relayId: string | null;
  location: string | null;
  coverUrl: string | null;
  startAt: string;
  endAt: string | null;
  status: 'scheduled' | 'active' | 'completed' | 'canceled';
  recurrence?: Recurrence;
  creator: Pick<UserRef, 'id' | 'username' | 'displayName' | 'avatarUrl'> | null;
  interestedCount: number;
  meInterested?: boolean;
}

interface CommunityState {
  prefs: Record<string, RelayPrefs>;
  events: Record<string, BeaconEvent[]>;
}

export const useCommunity = create<CommunityState>()(() => ({ prefs: {}, events: {} }));
const set = useCommunity.setState;
const get = useCommunity.getState;

const NO_PREFS: RelayPrefs = { hiddenRelayIds: [], selectedOptionIds: [], activity: {} };
export const prefsFor = (beaconId: string) => get().prefs[beaconId] ?? NO_PREFS;

export async function loadRelayPrefs(beaconId: string) {
  const res = await optional(http.get<RelayPrefs>(`/beacons/${beaconId}/relay-prefs`), null);
  if (res) set((s) => ({ prefs: { ...s.prefs, [beaconId]: { ...NO_PREFS, ...res } } }));
}

/** Hides or shows relays in my sidebar (optimistic; the server drops unhideable ones). */
export async function setHiddenRelays(beaconId: string, hiddenRelayIds: string[]) {
  const before = prefsFor(beaconId);
  set((s) => ({ prefs: { ...s.prefs, [beaconId]: { ...before, hiddenRelayIds } } }));
  try {
    const res = await http.put<{ hiddenRelayIds: string[] }>(`/beacons/${beaconId}/relay-prefs`, { hiddenRelayIds });
    set((s) => ({ prefs: { ...s.prefs, [beaconId]: { ...prefsFor(beaconId), hiddenRelayIds: res.hiddenRelayIds } } }));
  } catch (err) {
    set((s) => ({ prefs: { ...s.prefs, [beaconId]: before } }));
    throw err;
  }
}

export function applySelections(beaconId: string, res: { selectedOptionIds: string[]; hiddenRelayIds: string[] }) {
  set((s) => ({ prefs: { ...s.prefs, [beaconId]: { ...prefsFor(beaconId), ...res } } }));
}

const byStart = (a: BeaconEvent, b: BeaconEvent) => (a.status === 'active' ? -1 : b.status === 'active' ? 1 : a.startAt.localeCompare(b.startAt));
const open = (e: BeaconEvent) => e.status === 'scheduled' || e.status === 'active';

export async function loadEvents(beaconId: string) {
  const res = await optional(http.get<{ events: BeaconEvent[] }>(`/beacons/${beaconId}/events`), null);
  if (res) set((s) => ({ events: { ...s.events, [beaconId]: res.events.filter(open).sort(byStart) } }));
}

/** Adds or replaces an event. Broadcasts carry no meInterested, so mine is kept unless the payload says otherwise. */
export function upsertEvent(event: BeaconEvent): BeaconEvent | undefined {
  const list = get().events[event.beaconId] ?? [];
  const prev = list.find((e) => e.id === event.id);
  const merged = { ...event, meInterested: event.meInterested ?? prev?.meInterested ?? false };
  const next = [...list.filter((e) => e.id !== event.id), ...(open(merged) ? [merged] : [])].sort(byStart);
  set((s) => ({ events: { ...s.events, [event.beaconId]: next } }));
  return prev;
}

export function removeEvent(beaconId: string, eventId: string) {
  set((s) => ({ events: { ...s.events, [beaconId]: (s.events[beaconId] ?? []).filter((e) => e.id !== eventId) } }));
}

// The Inbox's own data: which transmissions are bookmarked, reminders that came due, and channels
// someone marked unread (which stay unread until they leave them or send there, rather than
// being read again the moment the view scrolls).
import { create } from 'zustand';
import { http } from '../../lib/http';
import { getState, setState } from '../../data/store';
import { parseChannelKey, type ChannelKey } from '../../lib/types';
import { toast } from '../../app/ui';

interface InboxState {
  /** Transmission ids I bookmarked (null until loaded). */
  bookmarked: Set<string> | null;
  /** Reminders that came due and are not done: the Inbox's badge. */
  dueReminders: number;
  /** Channels marked unread by hand, with when: automatic reads skip them for now. */
  held: Partial<Record<ChannelKey, number>>;
}

export const useInbox = create<InboxState>(() => ({ bookmarked: null, dueReminders: 0, held: {} }));

export async function loadInboxData() {
  const [b, r] = await Promise.all([
    http.get<{ bookmarks: Array<{ transmission: { id: string } }> }>('/users/@me/bookmarks').catch(() => ({ bookmarks: [] })),
    http.get<{ reminders: Array<{ due: boolean }> }>('/users/@me/reminders').catch(() => ({ reminders: [] })),
  ]);
  useInbox.setState({ bookmarked: new Set(b.bookmarks.map((x) => x.transmission.id)), dueReminders: r.reminders.filter((x) => x.due).length });
}

export async function setBookmarked(transmissionId: string, on: boolean) {
  try {
    if (on) await http.put(`/users/@me/bookmarks/${transmissionId}`);
    else await http.delete(`/users/@me/bookmarks/${transmissionId}`);
    bookmarkChanged(transmissionId, on);
    toast(on ? 'Bookmarked' : 'Bookmark removed', 'success');
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

/** From this device or another (BOOKMARK_UPDATE). */
export function bookmarkChanged(transmissionId: string, on: boolean) {
  const next = new Set(useInbox.getState().bookmarked ?? []);
  if (on) next.add(transmissionId);
  else next.delete(transmissionId);
  useInbox.setState({ bookmarked: next });
}

/** The "Remind Me" choices, Discord's: a fixed time from now, or tomorrow / next week morning. */
export function reminderChoices(now = new Date()): Array<{ label: string; at: Date }> {
  const at = (ms: number) => new Date(now.getTime() + ms);
  const morning = (daysAhead: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const nextMonday = (() => {
    const days = ((8 - now.getDay()) % 7) || 7;
    return morning(days);
  })();
  return [
    { label: 'In 20 minutes', at: at(20 * 60_000) },
    { label: 'In 1 hour', at: at(3_600_000) },
    { label: 'In 3 hours', at: at(3 * 3_600_000) },
    { label: 'Tomorrow morning', at: morning(1) },
    { label: 'Next week', at: nextMonday },
  ];
}

export async function remindMe(transmissionId: string, at: Date) {
  try {
    await http.post('/users/@me/reminders', { transmissionId, remindAt: at.toISOString() });
    toast(`I'll remind you ${at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, 'success');
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

/** A reminder came due (REMINDER_DUE): say so here, and on the desktop when allowed. */
export function reminderDue(reminder: { transmission?: { content?: string; author?: { displayName?: string; username?: string } } | null }) {
  useInbox.setState((s) => ({ dueReminders: s.dueReminders + 1 }));
  const who = reminder.transmission?.author?.displayName || reminder.transmission?.author?.username;
  const what = (reminder.transmission?.content ?? '').slice(0, 120);
  toast(`Reminder${who ? ` · ${who}` : ''}: ${what || 'a transmission'} (in your Inbox)`, 'info');
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification('Reminder', { body: `${who ? `${who}: ` : ''}${what}`, icon: '/brand/star.png' });
    }
  } catch {
    /* notifications unavailable */
  }
}

/**
 * Mark Unread (Discord's): this transmission and everything after it are unread again. The
 * channel then stays unread while it is open, until I leave it, send there, or mark it read.
 */
export async function markUnread(key: ChannelKey, transmissionId: string) {
  const { type, id } = parseChannelKey(key);
  try {
    const r = await http.post<{ lastReadId: string | null; mentionCount: number }>(`/channels/${type}/${id}/unread`, { transmissionId });
    const before = getState().messages[key]?.byId[r.lastReadId ?? '']?.createdAt ?? null;
    hold(key);
    setState((s) => ({ readStates: { ...s.readStates, [key]: { lastReadId: r.lastReadId, lastReadAt: before, mentionCount: r.mentionCount } } }));
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

export const hold = (key: ChannelKey) => useInbox.setState((s) => ({ held: { ...s.held, [key]: Date.now() } }));
export const isHeld = (key: ChannelKey) => !!useInbox.getState().held[key];
export function release(key: ChannelKey) {
  if (!isHeld(key)) return;
  useInbox.setState((s) => {
    const held = { ...s.held };
    delete held[key];
    return { held };
  });
}

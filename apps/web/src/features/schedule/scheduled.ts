// Scheduled transmissions: kept on the device they were scheduled on (never on the server), and
// sent by it at their time. The device has to be online then. "Send when available" lets it send
// late once it is back online; without it, a transmission whose time passed while the device was
// offline (or the app closed) stays at the end of its chat, greyed out and unsent, until it is
// sent by hand or deleted.
import { create } from 'zustand';
import { getState } from '../../data/store';
import { sendMessage } from '../../data/actions';
import type { ChannelKey } from '../../lib/types';

export interface Scheduled {
  id: string;
  key: ChannelKey;
  content: string;
  /** When to send it (ms since epoch). */
  sendAt: number;
  /** Send late when the device comes back online, instead of leaving it unsent. */
  whenAvailable: boolean;
  status: 'pending' | 'sending' | 'unsent';
}

/** How late "on time" may be: the timer runs every few seconds, and a send takes a moment. */
export const GRACE_MS = 60_000;
const TICK_MS = 5_000;
/** One account's list per device. */
const storageKey = () => `subspace_scheduled:${getState().me?.id ?? 'anon'}`;

const read = (): Scheduled[] => {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
    return Array.isArray(v) ? v.map((s: Scheduled) => (s.status === 'sending' ? { ...s, status: 'pending' } : s)) : [];
  } catch {
    return [];
  }
};
const write = (list: Scheduled[]) => {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(list));
  } catch {
    /* storage full or blocked: it lasts this session */
  }
};

export const useScheduled = create<{ items: Scheduled[] }>(() => ({ items: [] }));
const set = (items: Scheduled[]) => {
  useScheduled.setState({ items });
  write(items);
};
const update = (id: string, patch: Partial<Scheduled> | null) =>
  set(patch ? useScheduled.getState().items.map((s) => (s.id === id ? { ...s, ...patch } : s)) : useScheduled.getState().items.filter((s) => s.id !== id));

export function schedule(key: ChannelKey, content: string, sendAt: number, whenAvailable: boolean) {
  const item: Scheduled = { id: `${Date.now()}${Math.random().toString(36).slice(2, 8)}`, key, content, sendAt, whenAvailable, status: 'pending' };
  set([...useScheduled.getState().items, item].sort((a, b) => a.sendAt - b.sendAt));
  return item;
}

export const cancelScheduled = (id: string) => update(id, null);

/** Send it now (from the greyed-out entry). */
export async function sendScheduledNow(id: string) {
  const item = useScheduled.getState().items.find((s) => s.id === id);
  if (!item || item.status === 'sending') return;
  update(id, { status: 'sending' });
  try {
    await sendMessage(item.key, item.content);
    update(id, null);
  } catch {
    update(id, { status: item.status });
  }
}

/** Online as far as this device can tell: the browser says so and the gateway is connected. */
const online = () => navigator.onLine && getState().gatewayStatus === 'ready';

/** One pass: send what is due while online; leave what missed its time unsent (or late, if allowed). */
export async function tick(now = Date.now(), isOnline = online()) {
  for (const item of useScheduled.getState().items) {
    if (item.status !== 'pending' || item.sendAt > now) continue;
    const late = now - item.sendAt > GRACE_MS;
    if (isOnline && (!late || item.whenAvailable)) {
      await sendScheduledNow(item.id);
    } else if (late && !item.whenAvailable) {
      update(item.id, { status: 'unsent' });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Load this account's scheduled transmissions and start sending them. Returns the stop. */
export function startScheduler(): () => void {
  useScheduled.setState({ items: read() });
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  const onOnline = () => void tick();
  window.addEventListener('online', onOnline);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    window.removeEventListener('online', onOnline);
  };
}

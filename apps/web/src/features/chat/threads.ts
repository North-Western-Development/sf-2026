import { create } from 'zustand';
import { http } from '../../lib/http';

export interface ThreadSummary {
  id: string;
  relayId: string;
  title: string;
  creatorId: string;
  starterTransmissionId: string | null;
  isLocked: boolean;
  /** Invite-only: its members and Manage Threads see it. */
  isPrivate?: boolean;
  messageCount: number;
  lastTransmissionAt: string;
  createdAt: string;
}

/** Text-relay threads by relay, kept fresh by THREAD_CREATE / THREAD_UPDATE and thread messages. */
export const useThreads = create<{ byRelay: Record<string, ThreadSummary[] | undefined>; byId: Record<string, ThreadSummary> }>()(() => ({ byRelay: {}, byId: {} }));

export function upsertThread(t: ThreadSummary) {
  useThreads.setState((s) => {
    const list = s.byRelay[t.relayId];
    const next = list ? [t, ...list.filter((x) => x.id !== t.id)].sort((a, b) => b.lastTransmissionAt.localeCompare(a.lastTransmissionAt)) : list;
    return { byId: { ...s.byId, [t.id]: t }, byRelay: next ? { ...s.byRelay, [t.relayId]: next } : s.byRelay };
  });
}

export async function loadThreads(relayId: string) {
  const r = await http.get<{ threads: ThreadSummary[] }>(`/relays/${relayId}/threads`);
  useThreads.setState((s) => ({ byRelay: { ...s.byRelay, [relayId]: r.threads }, byId: { ...s.byId, ...Object.fromEntries(r.threads.map((t) => [t.id, t])) } }));
  return r.threads;
}

export async function createThread(relayId: string, name: string, starterTransmissionId?: string, isPrivate = false) {
  const r = await http.post<{ thread: ThreadSummary }>(`/relays/${relayId}/threads`, { name, starterTransmissionId, ...(isPrivate ? { private: true } : {}) });
  upsertThread(r.thread);
  return r.thread;
}

/** THREAD_DELETE: a thread went away for me (removed from a private one). */
export function dropThread(relayId: string, threadId: string) {
  useThreads.setState((s) => {
    const byId = { ...s.byId };
    delete byId[threadId];
    const list = s.byRelay[relayId];
    return { byId, byRelay: list ? { ...s.byRelay, [relayId]: list.filter((t) => t.id !== threadId) } : s.byRelay };
  });
}

/** A new transmission in a thread: count it and move the thread to the top. */
export function bumpThread(threadId: string, at: string) {
  const t = useThreads.getState().byId[threadId];
  if (t) upsertThread({ ...t, messageCount: t.messageCount + 1, lastTransmissionAt: at });
}

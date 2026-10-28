import { randomKey } from '@subspace/e2ee';
import { getState, useStore } from '../../data/store';
import { rtcManager } from '../../services/rtc';
import { sendSignal } from '../../lib/e2ee/client';

/**
 * Frame keys for end-to-end encrypted calls and Comm-Links. The first person in a room makes
 * a random key; everyone joining later asks the people already there, who answer with
 * Double Ratchet envelopes through the server relay, which cannot read them. A key is only
 * ever given to someone the gateway shows as connected to that same room.
 *
 * Keys have an epoch. When someone leaves, the person left with the smallest id makes a new
 * key (epoch + 1) and sends it to everyone still there, so whoever left cannot decrypt what
 * follows. Each side installs the new key for receiving first and switches its sending key a
 * moment later, so no frame is lost while the key travels.
 *
 * Conflicts (two people starting a room, or rotating at once) settle the same way everywhere:
 * the higher epoch wins, and within an epoch the smaller key.
 */

type KeyMessage = { type: 'key-request' } | { type: 'key'; key: string; epoch?: number } | { type: 'rotate'; key: string; epoch: number };

/** LiveKit's keyring holds 16 keys; an epoch uses slot epoch % 16. */
const KEYRING = 16;
const REQUEST_TIMEOUT_MS = 6000;
/** How long a rotated key is receive-only before everyone sends with it. */
export const SWITCH_DELAY_MS = 1500;

let active: { topic: string; key: string | null; epoch: number; members: Set<string>; unsubscribe: () => void } | null = null;
const waiters = new Set<(key: string) => void>();

/** The voice-state test for "is this person in that room right now". */
function inRoom(userId: string, topic: string): boolean {
  const v = getState().voice[userId];
  if (!v) return false;
  return topic === `relay:${v.relayId}` || topic === `call:${v.callKey}`;
}

/** Everyone else the gateway shows in the room. */
function othersIn(topic: string): Set<string> {
  const me = getState().me?.id;
  return new Set(Object.keys(getState().voice).filter((id) => id !== me && inRoom(id, topic)));
}

/** The keyring slot of the current key (for connecting with it). */
export const roomKeyIndex = () => (active ? active.epoch % KEYRING : 0);

/** Use a key at once, for sending and receiving (joining, or no one else holds another). */
async function adopt(key: string, epoch: number) {
  if (!active) return;
  active.key = key;
  active.epoch = epoch;
  await rtcManager.setE2EEKey(key, epoch % KEYRING, true);
  for (const resolve of waiters) resolve(key);
  waiters.clear();
}

/** Move to a rotated key: receive with it now, send with it shortly. */
async function rotateTo(key: string, epoch: number) {
  if (!active) return;
  if (!active.key) return adopt(key, epoch);
  active.key = key;
  active.epoch = epoch;
  const topic = active.topic;
  await rtcManager.setE2EEKey(key, epoch % KEYRING, false);
  setTimeout(() => {
    if (active?.topic === topic && active.key === key && active.epoch === epoch) void rtcManager.setE2EEKey(key, epoch % KEYRING, true);
  }, SWITCH_DELAY_MS);
}

const send = (to: string, topic: string, msg: KeyMessage, device?: string) => {
  const me = getState().me;
  return me ? sendSignal(me.id, to, topic, msg, device).catch(() => {}) : Promise.resolve();
};

/** Someone left: the one left with the smallest id hands everyone a new key. */
async function onRoomChange() {
  if (!active?.key) return;
  const me = getState().me?.id;
  const now = othersIn(active.topic);
  const left = [...active.members].some((id) => !now.has(id));
  active.members = now;
  if (!left || !me || !now.size) return;
  if ([...now].some((id) => id < me)) return; // not ours to rotate
  const key = randomKey();
  const epoch = active.epoch + 1;
  const topic = active.topic;
  await rotateTo(key, epoch);
  await Promise.all([...now].map((id) => send(id, topic, { type: 'rotate', key, epoch })));
}

/**
 * Get the frame key for a room we just joined. `others` are the people already in it;
 * with nobody there, we make the key.
 */
export async function establishRoomKey(topic: string, others: string[]): Promise<string> {
  leaveRoomKey();
  let last = getState().voice;
  const unsubscribe = useStore.subscribe((s) => {
    if (s.voice === last) return;
    last = s.voice;
    void onRoomChange();
  });
  active = { topic, key: null, epoch: 0, members: new Set(others), unsubscribe };
  if (!others.length) {
    await adopt(randomKey(), 0);
    return active.key!;
  }
  const got = new Promise<string>((resolve) => waiters.add(resolve));
  await Promise.all(others.map((id) => send(id, topic, { type: 'key-request' })));
  const key = await Promise.race([got, new Promise<null>((r) => setTimeout(() => r(null), REQUEST_TIMEOUT_MS))]);
  if (key) return key;
  // Nobody answered (they may have left): start the room's key ourselves.
  if (active?.topic === topic && !active.key) await adopt(randomKey(), 0);
  return active!.key!;
}

export function leaveRoomKey() {
  active?.unsubscribe();
  active = null;
  waiters.clear();
}

/** Handle a decrypted signal from another device. */
export async function onRoomKeySignal(sig: { from: string; fromDevice: string; topic: string; message: unknown }) {
  const msg = sig.message as KeyMessage;
  const me = getState().me;
  if (!me || !active || active.topic !== sig.topic) return;

  if (msg.type === 'key-request') {
    // Give the key only to someone the gateway shows in this room (they may still be arriving).
    for (let i = 0; i < 15 && !inRoom(sig.from, sig.topic); i++) await new Promise((r) => setTimeout(r, 200));
    if (!inRoom(sig.from, sig.topic) || !active?.key) return;
    active.members.add(sig.from);
    await send(sig.from, sig.topic, { type: 'key', key: active.key, epoch: active.epoch }, sig.fromDevice);
    return;
  }

  if ((msg.type === 'key' || msg.type === 'rotate') && typeof msg.key === 'string' && inRoom(sig.from, sig.topic)) {
    const epoch = Number.isInteger(msg.epoch) && msg.epoch! >= 0 ? msg.epoch! : 0;
    if (!active.key) return adopt(msg.key, epoch);
    if (msg.key === active.key && epoch === active.epoch) return;
    const theirsWins = epoch > active.epoch || (epoch === active.epoch && msg.key < active.key);
    if (theirsWins) return rotateTo(msg.key, epoch);
    // They are behind, or lost the tie: hand them ours.
    await send(sig.from, sig.topic, { type: 'rotate', key: active.key, epoch: active.epoch }, sig.fromDevice);
  }
}

/** For tests: the current room key and its epoch. */
export const roomKeyState = () => (active ? { topic: active.topic, key: active.key, epoch: active.epoch } : null);
// Development builds only (the browser suite runs one): never in production.
if (import.meta.env.DEV) (window as any).__subspaceRoomKey = roomKeyState;

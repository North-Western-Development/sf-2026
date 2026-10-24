import { randomKey } from '@subspace/e2ee';
import { getState } from '../../data/store';
import { rtcManager } from '../../services/rtc';
import { sendSignal } from '../../lib/e2ee/client';

/**
 * Frame keys for end-to-end encrypted calls and Comm-Links. The first person in a room makes
 * a random key; everyone joining later asks the people already there, who answer with
 * Double Ratchet envelopes through the server relay, which cannot read them. A key is only
 * ever given to someone the gateway shows as connected to that same room.
 *
 * If two people start a room at once they hold different keys; each side keeps the smaller
 * one and sends it on, so both settle on the same key within a round trip.
 */

type KeyMessage = { type: 'key-request' } | { type: 'key'; key: string };

let active: { topic: string; key: string | null } | null = null;
const waiters = new Set<(key: string) => void>();
const REQUEST_TIMEOUT_MS = 6000;

/** The voice-state test for "is this person in that room right now". */
function inRoom(userId: string, topic: string): boolean {
  const v = getState().voice[userId];
  if (!v) return false;
  return topic === `relay:${v.relayId}` || topic === `call:${v.callKey}`;
}

async function adopt(key: string) {
  if (!active) return;
  active.key = key;
  await rtcManager.setE2EEKey(key);
  for (const resolve of waiters) resolve(key);
  waiters.clear();
}

/**
 * Get the frame key for a room we just joined. `others` are the people already in it;
 * with nobody there, we make the key.
 */
export async function establishRoomKey(topic: string, others: string[]): Promise<string> {
  const me = getState().me!;
  active = { topic, key: null };
  if (!others.length) {
    await adopt(randomKey());
    return active.key!;
  }
  const got = new Promise<string>((resolve) => waiters.add(resolve));
  await Promise.all(others.map((id) => sendSignal(me.id, id, topic, { type: 'key-request' } satisfies KeyMessage).catch(() => {})));
  const key = await Promise.race([got, new Promise<null>((r) => setTimeout(() => r(null), REQUEST_TIMEOUT_MS))]);
  if (key) return key;
  // Nobody answered (they may have left): start the room's key ourselves.
  if (active?.topic === topic && !active.key) await adopt(randomKey());
  return active!.key!;
}

export function leaveRoomKey() {
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
    await sendSignal(me.id, sig.from, sig.topic, { type: 'key', key: active.key } satisfies KeyMessage, sig.fromDevice).catch(() => {});
    return;
  }

  if (msg.type === 'key' && typeof msg.key === 'string' && inRoom(sig.from, sig.topic)) {
    if (!active.key) return adopt(msg.key);
    if (msg.key === active.key) return;
    // Two keys for one room: everyone keeps the smaller.
    if (msg.key < active.key) await adopt(msg.key);
    else await sendSignal(me.id, sig.from, sig.topic, { type: 'key', key: active.key } satisfies KeyMessage, sig.fromDevice).catch(() => {});
  }
}

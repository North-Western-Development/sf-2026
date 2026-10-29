import { getState, patchMessage } from './store';
import { parseChannelKey, type ChannelKey, type Transmission } from '../lib/types';
import { decryptTransmission, encryptPayload, rememberSent, type EncryptedPayload } from '../lib/e2ee/client';
import type { Plain } from '../lib/e2ee/keystore';

/** Whether a conversation only takes ciphertext. */
export function isEncryptedChannel(key: ChannelKey): boolean {
  const { type, id } = parseChannelKey(key);
  if (type === 'link') return !!getState().links[id]?.encryptedAt;
  if (type === 'mesh') return !!getState().meshes[id]?.encryptedAt;
  return false;
}

/**
 * Who a transmission in an encrypted conversation is for (besides the sender's own devices).
 * In a group DM that is every other member: each of their devices gets its own sealed
 * envelope, so someone who leaves cannot read what is sent after.
 */
function recipientsOf(key: ChannelKey): string[] {
  const { type, id } = parseChannelKey(key);
  const s = getState();
  if (type === 'link') {
    const link = s.links[id];
    return link ? [link.recipient.id] : [];
  }
  if (type === 'mesh') return (s.meshes[id]?.members ?? []).map((m) => m.id).filter((uid) => uid !== s.me?.id);
  return [];
}

/** Encrypt for a conversation: the payload to send, and the plaintext as sent (to remember). */
export function encryptFor(key: ChannelKey, plain: Plain): Promise<{ payload: EncryptedPayload; plain: Plain }> {
  const me = getState().me;
  if (!me) throw new Error('Not signed in');
  const recipients = recipientsOf(key);
  // Never seal a conversation's message for this person alone.
  if (!recipients.length) throw new Error('Could not tell who is in this conversation; try again');
  return encryptPayload(me.id, recipients, plain);
}

export { rememberSent };

/**
 * Decrypt any encrypted transmissions in `items` that are still sealed, and fill in their text.
 * Safe to call repeatedly: decrypted text is cached per transmission and edit.
 */
export function openEncrypted(key: ChannelKey, items: Transmission[]) {
  const me = getState().me;
  if (!me) return;
  for (const t of items) {
    if (!t.encrypted || t.e2ee !== 'pending') continue;
    void decryptTransmission(me.id, t.id, t.author.id, t.encrypted as EncryptedPayload, t.editedAt ?? '').then((result) => {
      const cur = getState().messages[key]?.byId[t.id];
      if (!cur || cur.editedAt !== t.editedAt) return; // edited again meanwhile
      if (result.ok) patchMessage(key, t.id, { content: result.plain.text, encryptedAttachments: result.plain.attachments ?? [], e2ee: 'ok' });
      else patchMessage(key, t.id, { e2ee: result.reason });
    });
  }
}

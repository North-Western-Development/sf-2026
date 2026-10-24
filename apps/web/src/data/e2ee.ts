import { getState, patchMessage } from './store';
import { parseChannelKey, type ChannelKey, type Transmission } from '../lib/types';
import { decryptTransmission, encryptPayload, rememberSent, type EncryptedPayload } from '../lib/e2ee/client';
import type { Plain } from '../lib/e2ee/keystore';

/** Whether a conversation only takes ciphertext. */
export function isEncryptedChannel(key: ChannelKey): boolean {
  const { type, id } = parseChannelKey(key);
  return type === 'link' && !!getState().links[id]?.encryptedAt;
}

/** Who a transmission in an encrypted link is for (besides the sender's own devices). */
function recipientsOf(key: ChannelKey): string[] {
  const { type, id } = parseChannelKey(key);
  const link = type === 'link' ? getState().links[id] : undefined;
  return link ? [link.recipient.id] : [];
}

export function encryptFor(key: ChannelKey, plain: Plain): Promise<EncryptedPayload> {
  const me = getState().me;
  if (!me) throw new Error('Not signed in');
  return encryptPayload(me.id, recipientsOf(key), plain);
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

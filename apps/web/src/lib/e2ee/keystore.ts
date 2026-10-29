import type { DeviceKeys, Session } from '@subspace/e2ee';

/**
 * Local, per-browser storage for end-to-end encryption, in IndexedDB. Private keys are
 * non-extractable CryptoKeys, so even script on this page cannot export them.
 *
 * - `device`: this browser's keys per signed-in account (and its server device id)
 * - `sessions`: Double Ratchet sessions per remote device
 * - `plaintext`: transmissions already decrypted (ratchet keys work once, so history is kept)
 */

export interface DeviceRecord {
  userId: string;
  deviceId: string;
  keys: DeviceKeys;
  /** Seals the sender's own copy of each transmission so it can be read back after a reload. */
  selfKey: string;
}

export interface Plain {
  text: string;
  attachments?: EncryptedAttachment[];
  /** The message-franking key (packages/e2ee): revealed with the text to report it. Absent before franking. */
  fk?: string;
}

/** An attachment encrypted on the device: the vault only holds ciphertext. */
export interface EncryptedAttachment {
  url: string;
  key: string;
  filename: string;
  mimeType: string;
  size: number;
}

const DB = 'subspace-e2ee';
let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('device');
      db.createObjectStore('sessions');
      db.createObjectStore('plaintext');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const getDevice = (userId: string) => run<DeviceRecord | undefined>('device', 'readonly', (s) => s.get(userId));
export const putDevice = (record: DeviceRecord) => run('device', 'readwrite', (s) => s.put(record, record.userId));
export const deleteDevice = (userId: string) => run('device', 'readwrite', (s) => s.delete(userId));

const sessionKey = (userId: string, remoteDeviceId: string) => `${userId}|${remoteDeviceId}`;
export const getSessions = async (userId: string, remoteDeviceId: string) => (await run<Session[] | undefined>('sessions', 'readonly', (s) => s.get(sessionKey(userId, remoteDeviceId)))) ?? [];
export const putSessions = (userId: string, remoteDeviceId: string, sessions: Session[]) => run('sessions', 'readwrite', (s) => s.put(sessions, sessionKey(userId, remoteDeviceId)));

export const getPlain = (messageId: string) => run<Plain | undefined>('plaintext', 'readonly', (s) => s.get(messageId));
export const putPlain = (messageId: string, plain: Plain) => run('plaintext', 'readwrite', (s) => s.put(plain, messageId));

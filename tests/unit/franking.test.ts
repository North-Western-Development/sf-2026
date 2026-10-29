import { describe, it, expect } from 'vitest';
import { frankingCommitment as clientCommit, randomKey } from '@subspace/e2ee';
import { frankingCommitment as serverCommit, opensCommitment, storedCommitment } from '../../apps/api-service/src/lib/franking.js';

/** Message franking: the client (packages/e2ee) and the API must agree on every byte. */
describe('Message franking', () => {
  const att = [{ url: '/api/v1/vault/files/1', key: randomKey(), filename: 'proof.png', mimeType: 'image/png', size: 1234 }];

  it('client and server compute the same commitment', async () => {
    for (const [text, attachments] of [
      ['hello', undefined],
      ['', []],
      ['émoji 🚀 "quotes" \\ and \u0000 nul', att],
    ] as const) {
      const fk = randomKey();
      expect(serverCommit(fk, text, attachments)).toBe(await clientCommit(fk, text, attachments));
    }
  });

  it('opens only with the same contents and key', async () => {
    const fk = randomKey();
    const c = await clientCommit(fk, 'meet me at 9', att);
    expect(opensCommitment(c, fk, 'meet me at 9', att)).toBe(true);
    expect(opensCommitment(c, fk, 'meet me at 10', att)).toBe(false);
    expect(opensCommitment(c, randomKey(), 'meet me at 9', att)).toBe(false);
    expect(opensCommitment(c, fk, 'meet me at 9', [])).toBe(false);
    expect(opensCommitment(c, fk, 'meet me at 9', [{ ...att[0], key: randomKey() }])).toBe(false);
    // Text cannot move into an attachment field, or between fields.
    expect(opensCommitment(c, fk, 'meet me at 9', [{ ...att[0], filename: 'other.png' }])).toBe(false);
  });

  it('refuses keys of the wrong size or encoding', async () => {
    const fk = randomKey();
    const c = await clientCommit(fk, 'x');
    expect(opensCommitment(c, fk.slice(0, 20), 'x')).toBe(false);
    expect(opensCommitment(c, `${fk}AA`, 'x')).toBe(false);
    // Base64 padding or the standard alphabet would decode to the same bytes: only the canonical form counts.
    expect(opensCommitment(c, `${fk}=`, 'x')).toBe(false);
    expect(opensCommitment(c, '', 'x')).toBe(false);
    await expect(clientCommit(fk.slice(0, 20), 'x')).rejects.toThrow();
  });

  it('reads a commitment only from a well-formed payload', () => {
    expect(storedCommitment(null)).toBeNull();
    expect(storedCommitment('not json')).toBeNull();
    expect(storedCommitment(JSON.stringify({ v: 1 }))).toBeNull();
    expect(storedCommitment(JSON.stringify({ commitment: 'short' }))).toBeNull();
    const c = 'A'.repeat(43);
    expect(storedCommitment(JSON.stringify({ commitment: c }))).toBe(c);
  });
});

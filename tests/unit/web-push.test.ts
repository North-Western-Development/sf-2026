import { describe, it, expect } from 'vitest';
import { encryptWebPush, validKeys } from '../../apps/api-service/src/lib/web-push.js';

describe('Web Push encryption (RFC 8291)', () => {
  // RFC 8291 Appendix A.
  const p256dh = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
  const auth = 'BTBZMqHH6r4Tts7J_aSIgg';

  it('matches the RFC test vector', () => {
    const out = encryptWebPush(Buffer.from('When I grow up, I want to be a watermelon'), p256dh, auth, {
      salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
      senderKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'),
    });
    expect(out.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
    );
  });

  it('uses fresh keys for every message', () => {
    const a = encryptWebPush(Buffer.from('x'), p256dh, auth);
    const b = encryptWebPush(Buffer.from('x'), p256dh, auth);
    expect(a.equals(b)).toBe(false);
  });

  it('checks the shape of an install\'s keys', () => {
    expect(validKeys(p256dh, auth)).toBe(true);
    expect(validKeys(p256dh.slice(0, 40), auth)).toBe(false);
    expect(validKeys(p256dh, 'AAAA')).toBe(false);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { GDPR_COUNTRIES, isGdprEmail, isGdprPhone } from '@subspace/constants';
import { anonymizeIp, ipToBigInt, logRequest, regionBlocked } from '@subspace/database';

describe('GDPR regions', () => {
  it('knows EU, EEA and UK email domains, and leaves others alone', () => {
    for (const e of ['a@web.de', 'a@orange.fr', 'A@Libero.IT', 'a@yahoo.co.uk', 'a@example.eu', 'a@gmx.net', 'a@mail.gmx.net', 'a@x.berlin', 'a@x.no'])
      expect(isGdprEmail(e), e).toBe(true);
    for (const e of ['a@gmail.com', 'a@outlook.com', 'a@example.us', 'a@example.ch', 'a@notgmx.net', 'a@example.ca', 'nodomain'])
      expect(isGdprEmail(e), e).toBe(false);
  });

  it('knows EU, EEA and UK calling codes', () => {
    for (const p of ['+4915112345678', '+447700900123', '+353851234567', '+35799123456', '+262692123456', '+4791234567'])
      expect(isGdprPhone(p), p).toBe(true);
    for (const p of ['+15550100199', '+41791234567', '+61412345678', '+380501234567', '+74951234567'])
      expect(isGdprPhone(p), p).toBe(false);
  });

  it('the server script fetches ranges for exactly GDPR_COUNTRIES', () => {
    const script = fs.readFileSync(path.join(__dirname, '../../deploy/server/eu-ranges.sh'), 'utf8');
    const listed = /^COUNTRIES="([^"]+)"/m.exec(script)![1].split(' ');
    expect([...listed].sort()).toEqual([...GDPR_COUNTRIES].sort());
  });
});

describe('regionBlocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'region-'));
  afterEach(() => {
    delete process.env.BLOCK_EU;
    delete process.env.BLOCK_EU_RANGES;
  });

  it('parses IPv4, IPv6 and IPv4-mapped addresses', () => {
    expect(ipToBigInt('10.0.0.1')).toEqual({ v6: false, n: 167772161n });
    expect(ipToBigInt('::ffff:10.0.0.1')).toEqual({ v6: false, n: 167772161n });
    expect(ipToBigInt('::1')).toEqual({ v6: true, n: 1n });
    expect(ipToBigInt('not an ip')).toBeNull();
  });

  it('finds addresses in the ranges file (merged neighbours, both families), only when BLOCK_EU=true', () => {
    const file = path.join(dir, 'a.csv');
    // Out of order, with neighbours and an overlap.
    fs.writeFileSync(file, ['10.0.1.0,10.0.1.255,FR', '10.0.0.0,10.0.0.255,DE', '10.0.0.128,10.0.0.200,DE', '2001:db8::,2001:db8::ffff,NL', 'junk line'].join('\n'));
    process.env.BLOCK_EU_RANGES = file;
    expect(regionBlocked('10.0.0.5')).toBe(false);
    process.env.BLOCK_EU = 'true';
    for (const ip of ['10.0.0.0', '10.0.0.255', '10.0.1.0', '10.0.1.255', '::ffff:10.0.0.9', '2001:db8::1']) expect(regionBlocked(ip), ip).toBe(true);
    for (const ip of ['9.255.255.255', '10.0.2.0', '127.0.0.1', '2001:db8::1:0', '::1', '', 'nonsense']) expect(regionBlocked(ip), ip).toBe(false);
  });

  it('anonymizes addresses: IPv4 to its /24, IPv6 to its /48', () => {
    expect(anonymizeIp('81.2.69.142')).toBe('81.2.69.0');
    expect(anonymizeIp('::ffff:81.2.69.142')).toBe('81.2.69.0');
    expect(anonymizeIp('2a01:4f8:1c1c:abcd:1:2:3:4')).toBe('2a01:4f8:1c1c::');
    expect(anonymizeIp('2a01:4f8::1')).toBe('2a01:4f8:0::');
    expect(anonymizeIp('junk')).toBe('');
  });

  it('logs a refused visitor with an anonymized address, and others as they are', () => {
    const file = path.join(dir, 'b.csv');
    fs.writeFileSync(file, '10.0.0.0,10.0.0.255,DE\n');
    process.env.BLOCK_EU_RANGES = file;
    process.env.BLOCK_EU = 'true';
    expect(logRequest({ method: 'GET', url: '/x', ip: '10.0.0.77' })).toEqual({ method: 'GET', url: '/x', remoteAddress: '10.0.0.0', regionBlocked: true });
    expect(logRequest({ method: 'GET', url: '/x', ip: '11.0.0.77' })).toEqual({ method: 'GET', url: '/x', remoteAddress: '11.0.0.77' });
  });

  it('refuses nobody by address when the ranges file is missing', () => {
    process.env.BLOCK_EU = 'true';
    process.env.BLOCK_EU_RANGES = path.join(dir, 'missing.csv');
    expect(regionBlocked('10.0.0.5')).toBe(false);
  });
});

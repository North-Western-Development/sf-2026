import { describe, it, expect } from 'vitest';
import { isPrivateAddress } from '../../apps/api-service/src/lib/safe-fetch.js';
import { extractPreviewUrls, parsePageMetadata, signProxyUrl, verifyProxySignature } from '../../apps/api-service/src/lib/embeds.js';

describe('safe-fetch address filter', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.9', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false)
  );
});

describe('preview URL extraction', () => {
  it('finds links, trims sentence punctuation, keeps balanced parentheses', () => {
    expect(extractPreviewUrls('see https://a.example/x, and (https://en.example/wiki/Foo_(bar)).')).toEqual([
      'https://a.example/x',
      'https://en.example/wiki/Foo_(bar)',
    ]);
  });

  it('skips links in code, spoilers and angle brackets, and caps at five', () => {
    expect(extractPreviewUrls('`https://code.example` ```\nhttps://block.example\n``` <https://quiet.example> ||https://spoiler.example||')).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => `https://s${i}.example`).join(' ');
    expect(extractPreviewUrls(many)).toHaveLength(5);
    expect(extractPreviewUrls('https://dup.example https://dup.example')).toEqual(['https://dup.example/']);
  });
});

describe('page metadata', () => {
  it('reads Open Graph in any attribute order, decodes entities and resolves relative images', () => {
    const html = `<html><head><title>Fallback</title>
      <meta content="Ship &amp; Crew" property="og:title">
      <meta property='og:description' content='Logs &#8212; day 3'>
      <meta name="twitter:card" content="summary_large_image">
      <meta property="og:image" content="/img/hero.png">
      <meta name="theme-color" content="#3b8ef2">
      <meta property="og:site_name" content="Fleet">`;
    expect(parsePageMetadata(html, 'https://fleet.example/logs/3')).toMatchObject({
      title: 'Ship & Crew',
      description: 'Logs — day 3',
      siteName: 'Fleet',
      image: 'https://fleet.example/img/hero.png',
      largeImage: true,
      color: '#3b8ef2',
    });
  });

  it('ignores non-http image URLs and bad colours', () => {
    const meta = parsePageMetadata('<meta property="og:image" content="javascript:alert(1)"><meta name="theme-color" content="red;x">', 'https://a.example');
    expect(meta.image).toBeUndefined();
    expect(meta.color).toBeUndefined();
  });
});

describe('media proxy signatures', () => {
  it('only verifies URLs the server signed', () => {
    const url = 'https://img.example/a.png';
    expect(verifyProxySignature(url, signProxyUrl(url))).toBe(true);
    expect(verifyProxySignature('https://img.example/b.png', signProxyUrl(url))).toBe(false);
    expect(verifyProxySignature(url, '')).toBe(false);
  });
});

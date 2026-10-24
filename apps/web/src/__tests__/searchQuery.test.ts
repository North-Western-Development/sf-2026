import { describe, expect, it } from 'vitest';
import { activeToken, parseSearch, toSearchParams } from '../lib/searchQuery';

describe('search query syntax', () => {
  it('splits free text from filters, including quoted values', () => {
    expect(parseSearch('warp from:nova core has:image in:"deep space"')).toEqual({
      text: 'warp core',
      filters: [
        { key: 'from', value: 'nova' },
        { key: 'has', value: 'image' },
        { key: 'in', value: 'deep space' },
      ],
    });
  });

  it('leaves unknown key:value words as text', () => {
    expect(parseSearch('ratio 16:9 http://x.example')).toEqual({ text: 'ratio 16:9 http://x.example', filters: [] });
  });

  it('finds the filter under the caret', () => {
    expect(activeToken('hello from:no')).toEqual({ key: 'from', value: 'no', start: 6 });
    expect(activeToken('hello fr')).toEqual({ key: null, value: 'fr', start: 6 });
  });

  it('maps filters to API params and reports what it cannot resolve', () => {
    const users: Record<string, string> = { nova: 'u1' };
    const { params, errors } = toSearchParams(
      parseSearch('core from:nova mentions:ghost has:embed during:2026-10-23 pinned:true'),
      (n) => users[n] ?? null,
      () => null
    );
    expect(params.get('q')).toBe('core');
    expect(params.get('from')).toBe('u1');
    expect(params.get('has')).toBe('link');
    expect(params.get('pinned')).toBe('true');
    expect(new Date(params.get('before')!).getTime() - new Date(params.get('after')!).getTime()).toBe(86_400_001);
    expect(errors).toEqual(['No pilot named "ghost"']);
  });
});

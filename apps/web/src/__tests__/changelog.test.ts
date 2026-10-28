import { describe, it, expect } from 'vitest';
import { CHANGELOG, changelogFor, entryFor, unseenEntries, type ChangelogEntry } from '../features/changelog/changelog';

const log: ChangelogEntry[] = [
  { id: '2026-12-01', title: 'December', added: [{ title: 'Web thing', body: '.', platforms: ['web'] }, { title: 'Everywhere', body: '.' }] },
  { id: '2026-11-20b', title: 'Desktop fix', platforms: ['desktop'], fixed: [{ title: 'Tray', body: '.' }] },
  { id: '2026-11-20', title: 'November', improved: [{ title: 'Faster', body: '.' }] },
  { id: '2026-11-01', title: 'Desktop only items', added: [{ title: 'Updater', body: '.', platforms: ['desktop'] }] },
];

describe("What's New", () => {
  it('shows each platform only what concerns it', () => {
    expect(changelogFor('web', log).map((e) => e.id)).toEqual(['2026-12-01', '2026-11-20']);
    expect(changelogFor('desktop', log).map((e) => e.id)).toEqual(['2026-12-01', '2026-11-20b', '2026-11-20', '2026-11-01']);
    expect(entryFor(log[0], 'desktop')!.added!.map((i) => i.title)).toEqual(['Everywhere']);
    expect(entryFor(log[3], 'web')).toBeNull();
  });

  it('pops up what came out since they last looked on this platform, newest first, three at most', () => {
    expect(unseenEntries('desktop', '2026-11-20', '2026-01-01', log).map((e) => e.id)).toEqual(['2026-12-01', '2026-11-20b']);
    expect(unseenEntries('web', '2026-12-01', '2026-01-01', log)).toEqual([]);
    expect(unseenEntries('desktop', '2026-10-01', '2026-01-01', log)).toHaveLength(3);
  });

  it('the first time on a platform: only the newest entry, and only for accounts older than it', () => {
    expect(unseenEntries('web', undefined, '2026-06-01T10:00:00.000Z', log).map((e) => e.id)).toEqual(['2026-12-01']);
    expect(unseenEntries('web', undefined, '2026-12-01T10:00:00.000Z', log)).toEqual([]);
    expect(unseenEntries('web', undefined, '2026-12-02T10:00:00.000Z', log)).toEqual([]);
  });

  it('the real changelog is newest first with valid, unique ids, and every entry says something', () => {
    const ids = CHANGELOG.map((e) => e.id);
    expect(ids.every((id) => /^\d{4}-\d{2}-\d{2}[a-z]?$/.test(id))).toBe(true);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CHANGELOG) expect(['web', 'desktop', 'mobile'].some((p) => entryFor(e, p as 'web'))).toBe(true);
  });
});

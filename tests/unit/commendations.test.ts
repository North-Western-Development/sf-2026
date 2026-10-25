import { describe, it, expect } from 'vitest';
import { COMMENDATION_CATALOG, COMMENDATION_FAMILIES, highestPerFamily, qualifies, commendationDef } from '@subspace/database';

describe('badge rules', () => {
  const day = 86_400_000;
  const def = (code: string) => commendationDef(code)!;

  it('every catalog badge belongs to a family, and ladders climb', () => {
    const families = new Set(COMMENDATION_FAMILIES.map((f) => f.family));
    for (const c of COMMENDATION_CATALOG) expect(families.has(c.family)).toBe(true);
    for (const f of COMMENDATION_FAMILIES) {
      const tiers = COMMENDATION_CATALOG.filter((c) => c.family === f.family);
      expect(tiers.map((t) => t.tier)).toEqual(tiers.map((_, i) => i + 1));
      for (let i = 1; i < tiers.length; i++) expect(tiers[i].threshold).toBeGreaterThan(tiers[i - 1].threshold);
    }
  });

  it('checks each criterion', () => {
    const now = Date.UTC(2027, 5, 1);
    const fresh = { staffRank: 0, createdAt: new Date(now - 10 * day) };
    expect(qualifies(def('STAFF'), fresh)).toBe(false);
    expect(qualifies(def('STAFF'), { ...fresh, staffRank: 1 })).toBe(true);
    // Created after the 2027-01-01 cutoff: not early.
    expect(qualifies(def('EARLY_TRANSMITTER'), fresh)).toBe(false);
    expect(qualifies(def('EARLY_TRANSMITTER'), { ...fresh, createdAt: new Date(Date.UTC(2026, 11, 31)) })).toBe(true);
    expect(qualifies(def('ORBIT_1'), { ...fresh, createdAt: new Date(now - 365 * day) }, now)).toBe(true);
    expect(qualifies(def('ORBIT_1'), { ...fresh, createdAt: new Date(now - 364 * day) }, now)).toBe(false);
    expect(qualifies(def('SIGNAL_1'), { ...fresh, transmissionsSent: 9 })).toBe(false);
    expect(qualifies(def('SIGNAL_1'), { ...fresh, transmissionsSent: 10 })).toBe(true);
    expect(qualifies(def('COMM_LINK_1'), { ...fresh, voiceMinutes: 59.9 })).toBe(false);
    expect(qualifies(def('COMM_LINK_1'), { ...fresh, voiceMinutes: 60 })).toBe(true);
  });

  it('profiles show one badge per family, the highest level, and drop retired codes', () => {
    const rows = ['SIGNAL_1', 'COMM_LINK_1', 'SIGNAL_3', 'STAFF', 'SIGNAL_2', 'RETIRED_BADGE'].map((code) => ({ code }));
    expect(highestPerFamily(rows).map((r) => r.code)).toEqual(['STAFF', 'COMM_LINK_1', 'SIGNAL_3']);
  });
});

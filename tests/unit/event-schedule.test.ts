import { describe, it, expect } from 'vitest';
import { nextOccurrence } from '../../apps/api-service/src/lib/event-schedule.js';

const at = (iso: string) => new Date(iso);

describe('repeating events', () => {
  it('weekly, every other week and yearly keep the clock time', () => {
    expect(nextOccurrence(at('2026-10-24T20:00:00Z'), 'weekly')!.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(nextOccurrence(at('2026-10-24T20:00:00Z'), 'biweekly')!.toISOString()).toBe('2026-11-07T20:00:00.000Z');
    expect(nextOccurrence(at('2026-10-24T20:00:00Z'), 'yearly')!.toISOString()).toBe('2027-10-24T20:00:00.000Z');
  });

  it('every weekday skips the weekend', () => {
    // Friday -> Monday
    expect(nextOccurrence(at('2026-10-23T09:00:00Z'), 'weekdays')!.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(nextOccurrence(at('2026-10-26T09:00:00Z'), 'weekdays')!.toISOString()).toBe('2026-10-27T09:00:00.000Z');
  });

  it('monthly keeps the nth weekday, falling back to the last when there is no fifth', () => {
    // 2026-10-24 is the fourth Saturday; November's fourth Saturday is the 28th.
    expect(nextOccurrence(at('2026-10-24T20:00:00Z'), 'monthly')!.toISOString()).toBe('2026-11-28T20:00:00.000Z');
    // 2026-10-31 is the fifth Saturday; November has four, so the last (the 28th).
    expect(nextOccurrence(at('2026-10-31T20:00:00Z'), 'monthly')!.toISOString()).toBe('2026-11-28T20:00:00.000Z');
  });

  it('does not repeat by default', () => {
    expect(nextOccurrence(at('2026-10-24T20:00:00Z'), 'none')).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ key: string; content: string }> = [];
vi.mock('../data/actions', () => ({ sendMessage: vi.fn(async (key: string, content: string) => void sent.push({ key, content })) }));
vi.mock('../data/store', () => ({ getState: () => ({ me: { id: 'me' }, gatewayStatus: 'ready' }) }));

const { schedule, tick, useScheduled, GRACE_MS } = await import('../features/schedule/scheduled');
const statusOf = (id: string) => useScheduled.getState().items.find((i) => i.id === id)?.status ?? 'gone';

describe('scheduled transmissions', () => {
  beforeEach(() => {
    sent.length = 0;
    useScheduled.setState({ items: [] });
  });

  it('sends at its time while this device is online, not before', async () => {
    const t = Date.now();
    const item = schedule('relay:1' as any, 'hello later', t + 10_000, false);
    await tick(t, true);
    expect(sent).toEqual([]);
    await tick(t + 10_000, true);
    expect(sent).toEqual([{ key: 'relay:1', content: 'hello later' }]);
    expect(statusOf(item.id)).toBe('gone');
  });

  it('offline at its time: stays unsent, unless it may send when available', async () => {
    const t = Date.now();
    const strict = schedule('relay:1' as any, 'on time only', t, false);
    const flexible = schedule('relay:1' as any, 'whenever', t, true);
    // Offline within the grace minute: both wait.
    await tick(t + 1000, false);
    expect([statusOf(strict.id), statusOf(flexible.id)]).toEqual(['pending', 'pending']);
    // Still offline past it: the strict one gives up, the other keeps waiting.
    await tick(t + GRACE_MS + 1000, false);
    expect([statusOf(strict.id), statusOf(flexible.id)]).toEqual(['unsent', 'pending']);
    // Back online much later: only the flexible one is sent.
    await tick(t + 3_600_000, true);
    expect(sent.map((s) => s.content)).toEqual(['whenever']);
    expect(statusOf(strict.id)).toBe('unsent');
  });

  it('a time that passed while the app was closed counts as missed', async () => {
    const t = Date.now();
    const missed = schedule('relay:1' as any, 'missed', t - 2 * GRACE_MS, false);
    await tick(t, true);
    expect(sent).toEqual([]);
    expect(statusOf(missed.id)).toBe('unsent');
  });
});

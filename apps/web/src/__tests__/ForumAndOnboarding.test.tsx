import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const httpMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/http', () => ({ http: httpMock, optional: (p: Promise<unknown>, f: unknown) => p.catch(() => f), ApiError: class extends Error {} }));
vi.mock('../services/gateway', () => ({ gateway: { onDispatch: () => () => {}, updateVoiceState: vi.fn(), updatePresence: vi.fn() } }));

import { useStore } from '../data/store';
import { ForumView } from '../features/forum/ForumView';
import { OnboardingGate, useNeedsOnboarding } from '../features/onboarding/OnboardingGate';
import type { Relay } from '../lib/types';

const ME = { id: 'u-me', username: 'kira', discriminator: '0427', displayName: 'Kira', avatarUrl: null, email: 'k@b.io', bio: null, bannerUrl: null, bannerColor: null };
const relay: Relay = { id: 'r-forum', beaconId: 'b1', parentId: null, name: 'mission-logs', type: 'archival', topic: null, position: 0, isUnhideable: false, myPermissions: String((1n << 0n) | (1n << 1n)) };

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    me: ME as any,
    beacons: { b1: { id: 'b1', name: 'Bajor', ownerId: 'someone-else', description: null, iconUrl: null, bannerUrl: null, isDiscoverable: false } },
    relays: { [relay.id]: relay },
    members: { b1: { 'u-me': { transmitterId: 'u-me', beaconId: 'b1', user: ME as any, nickname: null, clearanceIds: [], hasCompletedOnboarding: false } } },
    messages: {},
  });
});

const threadRow = (id: string, title: string, tags: string[], pinned = false) => ({
  thread: { id, relayId: relay.id, title, tags, isPinned: pinned, isLocked: false, transmissionCount: 3, lastTransmissionAt: '2026-09-27T10:00:00Z', createdAt: '2026-09-26T10:00:00Z', transmitterId: 'u-2' },
  author: { id: 'u-2', username: 'odo', discriminator: '0001', displayName: 'Odo' },
  preview: `Preview of ${title}`,
  previewImage: null,
});

describe('ForumView', () => {
  const renderForum = () =>
    render(
      <MemoryRouter initialEntries={[`/channels/b1/${relay.id}`]}>
        <Routes>
          <Route path="/channels/:beaconId/:relayId" element={<ForumView relay={relay} />} />
          <Route path="/channels/:beaconId/:relayId/threads/:threadId" element={<ForumView relay={relay} />} />
        </Routes>
      </MemoryRouter>
    );

  it('lists real threads with previews, pinned first, and tags derived from data', async () => {
    httpMock.get.mockResolvedValue({ threads: [threadRow('t1', 'Warp core notes', ['engineering']), threadRow('t2', 'Station rules', ['meta'], true)] });
    renderForum();
    const titles = await screen.findAllByRole('heading', { level: 3 });
    expect(titles.map((h) => h.textContent)).toEqual(['Station rules', 'Warp core notes']);
    expect(screen.getByText(/Preview of Warp core notes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'engineering' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'bug-report' })).toBeNull();
  });

  it('filters by tag and search', async () => {
    httpMock.get.mockResolvedValue({ threads: [threadRow('t1', 'Warp core notes', ['engineering']), threadRow('t2', 'Station rules', ['meta'])] });
    renderForum();
    await screen.findByText('Warp core notes');
    await userEvent.click(screen.getByRole('button', { name: 'meta' }));
    expect(screen.queryByText('Warp core notes')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.type(screen.getByLabelText('Search posts'), 'warp');
    expect(screen.queryByText('Station rules')).toBeNull();
    expect(screen.getByText('Warp core notes')).toBeInTheDocument();
  });

  it('creates a post with the chosen tags', async () => {
    httpMock.get.mockResolvedValue({ threads: [] });
    httpMock.post.mockResolvedValue({ thread: { id: 't9', relayId: relay.id, title: 'New', tags: ['ops'], transmissionCount: 1, createdAt: '2026-09-27T10:00:00Z', transmitterId: 'u-me' } });
    renderForum();
    await screen.findByText('No posts yet');
    await userEvent.click(screen.getByRole('button', { name: /new post/i }));
    await userEvent.type(screen.getByLabelText(/title/i), 'New');
    await userEvent.type(screen.getByPlaceholderText(/markdown/i), 'Body');
    await userEvent.type(screen.getByLabelText('New tag'), 'Ops{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(httpMock.post).toHaveBeenCalledWith(`/relays/${relay.id}/archival/threads`, { title: 'New', content: 'Body', tags: ['ops'] });
  });
});

describe('OnboardingGate', () => {
  it('detects members who have not accepted the rules (owners never need to)', () => {
    let result = false;
    const Probe = () => {
      result = useNeedsOnboarding('b1');
      return null;
    };
    render(<Probe />);
    expect(result).toBe(true);
    useStore.setState((s) => ({ beacons: { b1: { ...s.beacons.b1, ownerId: 'u-me' } } }));
    render(<Probe />);
    expect(result).toBe(false);
  });

  it('requires agreeing before submitting and marks onboarding complete', async () => {
    httpMock.get.mockResolvedValue({ beaconName: 'Bajor', rulesText: '**Be kind**', hasCompletedOnboarding: false, optInClearances: [{ id: 'c1', name: 'Pilots', color: '#3DDC84' }] });
    httpMock.post.mockResolvedValue({ member: { clearanceIds: ['c1'] } });
    render(<OnboardingGate beaconId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await screen.findByText('Be kind');
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Pilots/ }));
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(submit);
    expect(httpMock.post).toHaveBeenCalledWith('/beacons/b1/onboarding/complete', { agreedToRules: true, selectedClearanceIds: ['c1'] });
    await waitFor(() => expect(useStore.getState().members.b1['u-me'].hasCompletedOnboarding).toBe(true));
  });
});

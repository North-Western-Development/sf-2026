import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const httpMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/http', () => ({ http: httpMock, optional: (p: Promise<unknown>, f: unknown) => p.catch(() => f), ApiError: class extends Error {} }));
vi.mock('../services/gateway', () => ({ gateway: { onDispatch: () => () => {}, updateVoiceState: vi.fn(), updatePresence: vi.fn() } }));

import { useStore } from '../data/store';
import { UserSettings } from '../features/settings/UserSettings';

const ME = {
  id: 'u-me',
  username: 'kira',
  discriminator: '0427',
  displayName: 'Kira',
  avatarUrl: null,
  email: 'kira@bajor.io',
  bio: null,
  pronouns: null,
  bannerUrl: null,
  bannerColor: '#3353D6',
  is2faEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  httpMock.get.mockResolvedValue({ passkeys: [] });
  useStore.setState({
    me: ME as any,
    beacons: { b1: { id: 'b1', name: 'Bajor', ownerId: 'someone-else', description: null, iconUrl: null, bannerUrl: null, isDiscoverable: false } },
    beaconOrder: ['b1'],
    members: {
      b1: {
        'u-me': { transmitterId: 'u-me', beaconId: 'b1', user: ME as any, nickname: null, clearanceIds: [], bio: 'Old beacon bio', pronouns: null, avatarUrl: null },
      },
    },
  });
});

describe('User Settings', () => {
  it('shows account rows with a masked email and the user tag', () => {
    render(<UserSettings />);
    expect(screen.getByRole('heading', { name: 'Account Info' })).toBeInTheDocument();
    expect(screen.getByText('kira#0427')).toBeInTheDocument();
    expect(screen.getByText(/\*{4}@bajor\.io/)).toBeInTheDocument();
    expect(screen.queryByText('kira@bajor.io')).toBeNull();
  });

  it('changes the password only once the confirmation matches', async () => {
    httpMock.patch.mockResolvedValue({});
    render(<UserSettings />);
    const passwordRow = screen.getByText('Password').closest('div')!.parentElement!;
    await userEvent.click(passwordRow.querySelector('button')!);
    await userEvent.type(screen.getByLabelText(/^Current Password/), 'old-secret');
    await userEvent.type(screen.getByLabelText(/^New Password/), 'new-secret-1');
    await userEvent.type(screen.getByLabelText(/^Confirm New Password/), 'new-secret-2');
    expect(screen.getByText(/Passwords do not match/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/^Confirm New Password/));
    await userEvent.type(screen.getByLabelText(/^Confirm New Password/), 'new-secret-1');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(httpMock.patch).toHaveBeenCalledWith('/auth/me/password', { currentPassword: 'old-secret', newPassword: 'new-secret-1' });
  });

  it('filters the nav with search', async () => {
    render(<UserSettings />);
    await userEvent.type(screen.getByLabelText('Search settings'), 'notif');
    const nav = screen.getByRole('navigation', { name: /User Settings sections/ });
    expect(nav).toHaveTextContent('Notifications');
    expect(nav).not.toHaveTextContent('Appearance');
  });

  it('beacon profile loads saved overrides and sends only changed fields', async () => {
    httpMock.patch.mockResolvedValue({ member: {} });
    render(<UserSettings tab="beacon-profile:b1" />);
    const bio = screen.getByLabelText('About Me') as HTMLTextAreaElement;
    expect(bio.value).toBe('Old beacon bio');
    await userEvent.clear(bio);
    await userEvent.type(bio, 'New beacon bio');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    // No nickname in the body: the API requires CHANGE_NICKNAME whenever one is sent.
    expect(httpMock.patch).toHaveBeenCalledWith('/beacons/b1/members/@me', { bio: 'New beacon bio' });
    await waitFor(() => expect(useStore.getState().members.b1['u-me'].bio).toBe('New beacon bio'));
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArchivalForumView } from '../ArchivalForumView';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getArchivalThreads: vi.fn(),
    getArchivalThread: vi.fn(),
    getArchivalThreadTransmissions: vi.fn(),
    createArchivalThread: vi.fn(),
    sendArchivalThreadReply: vi.fn(),
    updateArchivalThread: vi.fn(),
  },
}));

describe('Archival Forum Thread Lock and Replies Persistence', () => {
  const mockUser = {
    id: 'usr-author-123',
    callsign: 'cmdr_echo',
    name: 'Commander Echo',
    staffRank: 0,
    roles: ['operator'],
    isOwner: false,
  };

  const initialThread = {
    id: 'thread-alpha-1',
    relayId: 'relay-999',
    title: 'Hyperdrive Calibration Protocol',
    tags: ['engineering', 'calibration'],
    isPinned: false,
    isLocked: true,
    transmissionCount: 1,
    lastTransmissionAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    snippet: 'Initial parameters for the warp drive sequence',
    author: {
      id: 'usr-author-123',
      username: 'cmdr_echo',
      displayName: 'Commander Echo',
      avatarUrl: '⚡',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    vi.mocked(api.getArchivalThreads).mockResolvedValue({
      threads: [
        {
          thread: { ...initialThread },
          author: initialThread.author,
          rootTransmission: {
            id: 'tx-root-1',
            content: initialThread.snippet,
            createdAt: initialThread.createdAt,
          },
        },
      ],
    });

    vi.mocked(api.getArchivalThread).mockResolvedValue({
      thread: { ...initialThread },
      author: initialThread.author,
      rootTransmission: {
        id: 'tx-root-1',
        content: initialThread.snippet,
        createdAt: initialThread.createdAt,
      },
    });

    vi.mocked(api.getArchivalThreadTransmissions).mockResolvedValue({
      threadId: 'thread-alpha-1',
      transmissions: [
        {
          transmission: {
            id: 'tx-root-1',
            threadId: 'thread-alpha-1',
            transmitterId: 'usr-author-123',
            content: initialThread.snippet,
            createdAt: initialThread.createdAt,
          },
          author: initialThread.author,
        },
      ],
    });
  });

  it('renders locked banner when thread is locked and prevents sending', async () => {
    render(
      <ArchivalForumView
        relayId="relay-999"
        relayName="archives-deep-space"
        currentUser={mockUser}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Hyperdrive Calibration Protocol')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Hyperdrive Calibration Protocol'));

    await waitFor(() => {
      expect(screen.getByText(/This thread has been locked/i)).toBeInTheDocument();
    });

    expect(screen.getByTitle('Unlock Thread')).toBeInTheDocument();
  });

  it('allows author to unlock thread, saves override, and updates backend', async () => {
    vi.mocked(api.updateArchivalThread).mockResolvedValue({
      message: 'Thread parameters updated',
      thread: { ...initialThread, isLocked: false },
    });

    render(
      <ArchivalForumView
        relayId="relay-999"
        relayName="archives-deep-space"
        currentUser={mockUser}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Hyperdrive Calibration Protocol')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Hyperdrive Calibration Protocol'));

    await waitFor(() => {
      expect(screen.getByTitle('Unlock Thread')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Unlock Thread'));

    await waitFor(() => {
      expect(api.updateArchivalThread).toHaveBeenCalledWith('relay-999', 'thread-alpha-1', {
        isLocked: false,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Send a message in "Hyperdrive Calibration Protocol"...')
      ).toBeInTheDocument();
    });

    const overrides = JSON.parse(localStorage.getItem('subspace_thread_overrides_relay-999') || '{}');
    expect(overrides['thread-alpha-1'].isLocked).toBe(false);
  });

  it('sends reply once unlocked, persists to local cache and reloads seamlessly', async () => {
    localStorage.setItem(
      'subspace_thread_overrides_relay-999',
      JSON.stringify({ 'thread-alpha-1': { isLocked: false } })
    );

    vi.mocked(api.sendArchivalThreadReply).mockResolvedValue({
      message: 'Transmission posted to thread',
      transmission: {
        id: 'tx-reply-new',
        threadId: 'thread-alpha-1',
        transmitterId: 'usr-author-123',
        content: 'Harmonics synchronized to 1420.405 MHz',
        createdAt: new Date().toISOString(),
      },
    });

    // Initially, thread has only root transmission
    vi.mocked(api.getArchivalThreadTransmissions).mockResolvedValueOnce({
      threadId: 'thread-alpha-1',
      transmissions: [
        {
          transmission: {
            id: 'tx-root-1',
            threadId: 'thread-alpha-1',
            transmitterId: 'usr-author-123',
            content: initialThread.snippet,
            createdAt: initialThread.createdAt,
          },
          author: initialThread.author,
        },
      ],
    });

    // After send, it returns root + reply
    vi.mocked(api.getArchivalThreadTransmissions).mockResolvedValue({
      threadId: 'thread-alpha-1',
      transmissions: [
        {
          transmission: {
            id: 'tx-root-1',
            threadId: 'thread-alpha-1',
            transmitterId: 'usr-author-123',
            content: initialThread.snippet,
            createdAt: initialThread.createdAt,
          },
          author: initialThread.author,
        },
        {
          transmission: {
            id: 'tx-reply-new',
            threadId: 'thread-alpha-1',
            transmitterId: 'usr-author-123',
            content: 'Harmonics synchronized to 1420.405 MHz',
            createdAt: new Date().toISOString(),
          },
          author: initialThread.author,
        },
      ],
    });

    render(
      <ArchivalForumView
        relayId="relay-999"
        relayName="archives-deep-space"
        currentUser={mockUser}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Hyperdrive Calibration Protocol')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Hyperdrive Calibration Protocol'));

    const input = await screen.findByPlaceholderText(
      'Send a message in "Hyperdrive Calibration Protocol"...'
    );
    fireEvent.change(input, { target: { value: 'Harmonics synchronized to 1420.405 MHz' } });

    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(api.sendArchivalThreadReply).toHaveBeenCalledWith(
        'relay-999',
        'thread-alpha-1',
        'Harmonics synchronized to 1420.405 MHz'
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Harmonics synchronized to 1420.405 MHz/).length).toBeGreaterThan(0);
    });

    const savedReplies = JSON.parse(
      localStorage.getItem('subspace_thread_replies_thread-alpha-1') || '[]'
    );
    expect(savedReplies.length).toBeGreaterThan(0);
    expect(savedReplies[0].content).toBe('Harmonics synchronized to 1420.405 MHz');
  });
});

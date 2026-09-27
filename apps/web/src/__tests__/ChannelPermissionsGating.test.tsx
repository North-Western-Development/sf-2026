import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Lock, Send, Pin, Unlock } from 'lucide-react';

interface MockChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'archive' | 'gallery';
  canSend?: boolean;
  isLocked?: boolean;
}

interface MockUser {
  staffRank: number;
  roles: string[];
  isOwner?: boolean;
}

// Extracted representation of the Channel Message Composer gating logic
function MockChannelComposer({
  channel,
  user,
}: {
  channel: MockChannel;
  user: MockUser;
}) {
  const isStaffOrAdmin = Boolean(
    (user.staffRank && user.staffRank >= 1) ||
    user.isOwner ||
    user.roles?.some((r: string) => ['command staff', 'admin', 'moderator', 'sysop'].some(role => r.toLowerCase().includes(role)))
  );
  const isChannelLocked = Boolean(channel.isLocked);
  const canSendInChannel = channel.canSend !== false && !isChannelLocked && (
    channel.type !== 'announcement' || isStaffOrAdmin || channel.canSend === true
  );

  if (!canSendInChannel) {
    return (
      <div data-testid="channel-no-perm-box" className="px-4 pb-6 pt-0 bg-[#000000] relative select-none">
        <div className="bg-[#16171a]/80 border border-[#232529] rounded-[8px] flex items-center justify-center px-4 py-3 text-center min-h-[44px]">
          <div className="flex items-center gap-2 text-[#80848e] text-xs font-medium">
            <Lock className={`w-3.5 h-3.5 ${isChannelLocked ? 'text-[#e5a50a]' : 'text-[#50545c]'}`} />
            <span>
              {isChannelLocked 
                ? 'This channel is locked. You do not have permission to send transmissions.' 
                : 'You do not have permission to send transmissions in this channel.'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form data-testid="channel-composer-form" className="px-4 pb-6 pt-0 bg-[#000000] relative">
      <input
        type="text"
        placeholder={`Message #${channel.name}`}
        className="bg-transparent text-[#dbdee1]"
      />
      <button type="submit"><Send className="w-4 h-4" /></button>
    </form>
  );
}

// Extracted representation of Thread Reply Gating and Context Menu
function MockThreadView({
  thread,
  user,
  onToggleLock,
  onTogglePin,
}: {
  thread: { id: string; title: string; isLocked: boolean; isPinned: boolean };
  user: MockUser;
  onToggleLock: () => void;
  onTogglePin: () => void;
}) {
  const hasManagePerms = Boolean(
    user.isOwner ||
    (user.staffRank && user.staffRank >= 1) ||
    user.roles?.some(r => ['command staff', 'admin', 'moderator', 'sysop'].some(role => r.toLowerCase().includes(role)))
  );

  return (
    <div data-testid="thread-container">
      {/* Header */}
      <div data-testid="thread-header" className="flex items-center justify-between">
        <h3>{thread.title}</h3>
        {hasManagePerms && (
          <div data-testid="thread-perms-actions">
            <button data-testid="thread-lock-btn" onClick={onToggleLock}>
              {thread.isLocked ? <Unlock /> : <Lock />}
              {thread.isLocked ? 'Unlock Thread' : 'Lock Thread'}
            </button>
            <button data-testid="thread-pin-btn" onClick={onTogglePin}>
              <Pin />
              {thread.isPinned ? 'Unpin Thread' : 'Pin Thread'}
            </button>
          </div>
        )}
      </div>

      {/* Reply Box or Locked Grey Box */}
      {thread.isLocked ? (
        <div data-testid="thread-locked-box" className="p-4 border-t select-none">
          <div className="bg-[#16171a]/80 border border-[#232529] rounded-[8px] flex items-center justify-center px-4 py-3 text-center min-h-[44px]">
            <div className="flex items-center gap-2 text-[#80848e] text-xs font-medium">
              <Lock className="w-3.5 h-3.5 text-[#e5a50a]" />
              <span>This thread has been locked. You cannot send transmissions.</span>
            </div>
          </div>
        </div>
      ) : (
        <form data-testid="thread-reply-form" className="p-4 border-t">
          <input type="text" placeholder={`Send a message in "${thread.title}"...`} />
          <button type="submit"><Send className="w-4 h-4" /></button>
        </form>
      )}
    </div>
  );
}

describe('Channel & Thread Message Input Permissions Gating', () => {
  const regularUser: MockUser = { staffRank: 0, roles: ['Cadet'] };
  const staffUser: MockUser = { staffRank: 2, roles: ['Command Staff', 'Sysop'] };

  describe('Channel Composer', () => {
    it('renders input box in normal text channel with send permissions', () => {
      render(
        <MockChannelComposer
          channel={{ id: 'c1', name: 'general', type: 'text', canSend: true }}
          user={regularUser}
        />
      );

      expect(screen.getByTestId('channel-composer-form')).toBeInTheDocument();
      expect(screen.queryByTestId('channel-no-perm-box')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Message #general')).toBeInTheDocument();
    });

    it('renders textboxed size grey box stating no permissions when canSend is false', () => {
      render(
        <MockChannelComposer
          channel={{ id: 'c2', name: 'read-only', type: 'text', canSend: false }}
          user={regularUser}
        />
      );

      expect(screen.queryByTestId('channel-composer-form')).not.toBeInTheDocument();
      expect(screen.getByTestId('channel-no-perm-box')).toBeInTheDocument();
      expect(screen.getByText('You do not have permission to send transmissions in this channel.')).toBeInTheDocument();
    });

    it('renders textboxed size grey box stating channel is locked when isLocked is true', () => {
      render(
        <MockChannelComposer
          channel={{ id: 'c3', name: 'containment', type: 'text', isLocked: true }}
          user={regularUser}
        />
      );

      expect(screen.queryByTestId('channel-composer-form')).not.toBeInTheDocument();
      expect(screen.getByTestId('channel-no-perm-box')).toBeInTheDocument();
      expect(screen.getByText('This channel is locked. You do not have permission to send transmissions.')).toBeInTheDocument();
    });

    it('blocks regular user from sending in announcement channels, but allows staff', () => {
      const annChannel: MockChannel = { id: 'c4', name: 'fleet-announcements', type: 'announcement' };

      // Regular user
      const { rerender } = render(
        <MockChannelComposer channel={annChannel} user={regularUser} />
      );
      expect(screen.getByTestId('channel-no-perm-box')).toBeInTheDocument();
      expect(screen.queryByTestId('channel-composer-form')).not.toBeInTheDocument();

      // Staff user
      rerender(<MockChannelComposer channel={annChannel} user={staffUser} />);
      expect(screen.getByTestId('channel-composer-form')).toBeInTheDocument();
      expect(screen.queryByTestId('channel-no-perm-box')).not.toBeInTheDocument();
    });
  });

  describe('Thread View & Management Actions', () => {
    it('renders reply text box in active unlocked thread', () => {
      render(
        <MockThreadView
          thread={{ id: 't1', title: 'Orbital Navigation', isLocked: false, isPinned: false }}
          user={regularUser}
          onToggleLock={() => {}}
          onTogglePin={() => {}}
        />
      );

      expect(screen.getByTestId('thread-reply-form')).toBeInTheDocument();
      expect(screen.queryByTestId('thread-locked-box')).not.toBeInTheDocument();
    });

    it('renders textboxed size grey box in locked thread instead of text box', () => {
      render(
        <MockThreadView
          thread={{ id: 't2', title: 'Classified Flight Data', isLocked: true, isPinned: false }}
          user={regularUser}
          onToggleLock={() => {}}
          onTogglePin={() => {}}
        />
      );

      expect(screen.queryByTestId('thread-locked-box')).toBeInTheDocument();
      expect(screen.queryByTestId('thread-reply-form')).not.toBeInTheDocument();
      expect(screen.getByText('This thread has been locked. You cannot send transmissions.')).toBeInTheDocument();
    });

    it('provides lock/unlock and pin/unpin options for users with permissions', () => {
      const onToggleLock = vi.fn();
      const onTogglePin = vi.fn();

      render(
        <MockThreadView
          thread={{ id: 't3', title: 'Subspace Calibration', isLocked: false, isPinned: false }}
          user={staffUser}
          onToggleLock={onToggleLock}
          onTogglePin={onTogglePin}
        />
      );

      expect(screen.getByTestId('thread-perms-actions')).toBeInTheDocument();
      expect(screen.getByText('Lock Thread')).toBeInTheDocument();
      expect(screen.getByText('Pin Thread')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('thread-lock-btn'));
      expect(onToggleLock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('thread-pin-btn'));
      expect(onTogglePin).toHaveBeenCalledTimes(1);
    });

    it('does not expose thread management controls to users without perms', () => {
      render(
        <MockThreadView
          thread={{ id: 't4', title: 'General Chatter', isLocked: false, isPinned: false }}
          user={regularUser}
          onToggleLock={() => {}}
          onTogglePin={() => {}}
        />
      );

      expect(screen.queryByTestId('thread-perms-actions')).not.toBeInTheDocument();
    });
  });
});

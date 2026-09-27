import { describe, it, expect } from 'vitest';

describe('Hidden & Muted Channel Visibility & Styling Logic', () => {
  interface MockChannel {
    id: string;
    name: string;
    type: 'text' | 'voice';
    isHidden?: boolean;
    isMuted?: boolean;
  }

  it('keeps hidden channels in visible list if the channel is currently open', () => {
    const channels: MockChannel[] = [
      { id: 'chan-1', name: 'general', type: 'text', isHidden: false },
      { id: 'chan-2', name: 'secret-ops', type: 'text', isHidden: true },
      { id: 'chan-3', name: 'archives', type: 'text', isHidden: true },
    ];

    const showHiddenChannels = false;
    const selectedChannelId = 'chan-2'; // User has opened chan-2
    const inVoiceRoom = null;

    const visibleChannels = channels.filter(
      c => showHiddenChannels || !c.isHidden || c.id === selectedChannelId || c.id === inVoiceRoom
    );

    // chan-1 is unhidden -> visible
    // chan-2 is hidden BUT currently open -> visible
    // chan-3 is hidden and not open -> excluded
    expect(visibleChannels.map(c => c.id)).toEqual(['chan-1', 'chan-2']);
  });

  it('excludes hidden channels when navigating away to another channel', () => {
    const channels: MockChannel[] = [
      { id: 'chan-1', name: 'general', type: 'text', isHidden: false },
      { id: 'chan-2', name: 'secret-ops', type: 'text', isHidden: true },
    ];

    const showHiddenChannels = false;
    const selectedChannelId = 'chan-1'; // Navigated to chan-1
    const inVoiceRoom = null;

    const visibleChannels = channels.filter(
      c => showHiddenChannels || !c.isHidden || c.id === selectedChannelId || c.id === inVoiceRoom
    );

    expect(visibleChannels.map(c => c.id)).toEqual(['chan-1']);
  });

  it('correctly flags muted and open-hidden channels as greyed out', () => {
    const chanHidden: MockChannel = { id: 'c-hidden', name: 'hidden-chan', type: 'text', isHidden: true };
    const chanMuted: MockChannel = { id: 'c-muted', name: 'muted-chan', type: 'text', isMuted: true };
    const chanNormal: MockChannel = { id: 'c-normal', name: 'normal-chan', type: 'text' };

    const selectedChannelId = 'c-hidden';
    const mutedChannels: Record<string, boolean> = { 'c-muted': true };

    const checkChannelState = (chan: MockChannel) => {
      const isSelected = selectedChannelId === chan.id;
      const isChannelMuted = Boolean(mutedChannels[chan.id] || chan.isMuted);
      const isChannelHidden = Boolean(chan.isHidden);
      const isTemporarilyVisibleHidden = isChannelHidden && isSelected;
      const isGreyedOut = isChannelMuted || isChannelHidden;
      return { isSelected, isChannelMuted, isTemporarilyVisibleHidden, isGreyedOut };
    };

    expect(checkChannelState(chanHidden).isTemporarilyVisibleHidden).toBe(true);
    expect(checkChannelState(chanHidden).isGreyedOut).toBe(true);

    expect(checkChannelState(chanMuted).isChannelMuted).toBe(true);
    expect(checkChannelState(chanMuted).isGreyedOut).toBe(true);

    expect(checkChannelState(chanNormal).isGreyedOut).toBe(false);
  });
});

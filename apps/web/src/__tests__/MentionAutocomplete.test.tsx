import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MentionAutocomplete, MentionItem } from '../components/composer/MentionAutocomplete';

describe('MentionAutocomplete Component', () => {
  const mockUserItems: MentionItem[] = [
    { id: 'u1', type: 'user', name: 'Fleet Admiral Vance', subtitle: 'adm_vance', avatar: '👨‍🚀' },
    { id: 'u2', type: 'user', name: 'Echo-4 Specialist', subtitle: 'echo_four', avatar: '🛰️' },
    { id: 'all', type: 'special', name: 'everyone', subtitle: 'Notify everyone in channel' },
  ];

  const mockChannelItems: MentionItem[] = [
    { id: 'c1', type: 'channel', name: 'general-telemetry', channelType: 'text' },
    { id: 'c2', type: 'channel', name: 'comm-deck-1', channelType: 'voice' },
  ];

  it('renders user mention items when type is user', () => {
    render(
      <MentionAutocomplete
        isOpen={true}
        type="user"
        filter=""
        items={mockUserItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('MEMBERS & ROLES')).toBeInTheDocument();
    expect(screen.getByText('@Fleet Admiral Vance')).toBeInTheDocument();
    expect(screen.getByText('@Echo-4 Specialist')).toBeInTheDocument();
  });

  it('filters items correctly based on filter prop', () => {
    render(
      <MentionAutocomplete
        isOpen={true}
        type="user"
        filter="Vance"
        items={mockUserItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('@Fleet Admiral Vance')).toBeInTheDocument();
    expect(screen.queryByText('@Echo-4 Specialist')).not.toBeInTheDocument();
  });

  it('renders channel mention items when type is channel', () => {
    render(
      <MentionAutocomplete
        isOpen={true}
        type="channel"
        filter=""
        items={mockChannelItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('CHANNELS')).toBeInTheDocument();
    expect(screen.getByText('#general-telemetry')).toBeInTheDocument();
    expect(screen.getByText('#comm-deck-1')).toBeInTheDocument();
  });

  it('handles keyboard navigation and Enter to select', () => {
    const onSelect = vi.fn();
    render(
      <MentionAutocomplete
        isOpen={true}
        type="user"
        filter=""
        items={mockUserItems}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    // Press ArrowDown to highlight second item
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // Press Enter to select
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(mockUserItems[1]);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmojiPickerPopdown } from '../EmojiPickerPopdown';

describe('EmojiPickerPopdown (Discord-Grade UI)', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <EmojiPickerPopdown
        isOpen={false}
        onClose={vi.fn()}
        onSelectEmoji={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders top tabs (GIFs, Stickers, Emoji) and search input', () => {
    render(
      <EmojiPickerPopdown
        isOpen={true}
        onClose={vi.fn()}
        onSelectEmoji={vi.fn()}
      />
    );

    expect(screen.getByText('GIFs')).toBeInTheDocument();
    expect(screen.getByText('Stickers')).toBeInTheDocument();
    expect(screen.getByText('Emoji')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(':shortcode:')).toBeInTheDocument();
  });

  it('renders custom server glyphs and standard categories', () => {
    const customEmojis = [
      { id: 'e1', name: 'quantum_reactor', url: 'https://example.com/reactor.png' },
    ];

    render(
      <EmojiPickerPopdown
        isOpen={true}
        onClose={vi.fn()}
        onSelectEmoji={vi.fn()}
        customEmojis={customEmojis}
        serverName="Aegis Station"
      />
    );

    expect(screen.getByText('Aegis Station')).toBeInTheDocument();
    expect(screen.getByTitle(':quantum_reactor:')).toBeInTheDocument();
  });

  it('selects an emoji and triggers onSelectEmoji callback', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <EmojiPickerPopdown
        isOpen={true}
        onClose={onClose}
        onSelectEmoji={onSelect}
      />
    );

    const rocketEmoji = screen.getAllByRole('button', { name: '🚀' })[0];
    fireEvent.click(rocketEmoji);

    expect(onSelect).toHaveBeenCalledWith('🚀');
    expect(onClose).toHaveBeenCalled();
  });

  it('updates inspection footer on hovering an emoji', () => {
    render(
      <EmojiPickerPopdown
        isOpen={true}
        onClose={vi.fn()}
        onSelectEmoji={vi.fn()}
      />
    );

    expect(screen.getByText('Select an emoji')).toBeInTheDocument();

    const rocketEmoji = screen.getAllByRole('button', { name: '🚀' })[0];
    fireEvent.mouseEnter(rocketEmoji);

    expect(screen.getByText(':rocket:')).toBeInTheDocument();
  });
});

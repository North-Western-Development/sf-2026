import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownMessage } from '../MarkdownMessage';

describe('MarkdownMessage Component', () => {
  it('renders standard inline markdown formatting (bold, italic, code)', () => {
    const { container } = render(
      <MarkdownMessage content="This is **bold** and *italic* and `inline_code`." />
    );

    const strongEl = container.querySelector('strong');
    const emEl = container.querySelector('em');
    const codeEl = container.querySelector('code');

    expect(strongEl).toHaveTextContent('bold');
    expect(emEl).toHaveTextContent('italic');
    expect(codeEl).toHaveTextContent('inline_code');
  });

  it('renders spoilers and toggles on click', () => {
    render(<MarkdownMessage content="Classified: ||Subspace Frequencies||" />);

    const spoiler = screen.getByTitle('Click to reveal spoiler');
    expect(spoiler).toBeInTheDocument();

    fireEvent.click(spoiler);
    expect(screen.getByTitle('Click to conceal spoiler')).toBeInTheDocument();
  });

  it('renders @mentions and triggers onMentionClick when clicked', () => {
    const onMentionClick = vi.fn();
    render(
      <MarkdownMessage
        content="Paging @adm_vance for status update."
        onMentionClick={onMentionClick}
      />
    );

    const mentionEl = screen.getByText('@adm_vance');
    expect(mentionEl).toBeInTheDocument();

    fireEvent.click(mentionEl);
    expect(onMentionClick).toHaveBeenCalledWith('adm_vance');
  });

  it('renders #channel mentions and triggers onChannelClick when clicked', () => {
    const onChannelClick = vi.fn();
    render(
      <MarkdownMessage
        content="Check relay #announcements now."
        onChannelClick={onChannelClick}
      />
    );

    const channelEl = screen.getByText('#announcements');
    expect(channelEl).toBeInTheDocument();

    fireEvent.click(channelEl);
    expect(onChannelClick).toHaveBeenCalledWith('announcements');
  });
});

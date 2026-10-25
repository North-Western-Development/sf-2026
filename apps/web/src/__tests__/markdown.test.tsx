import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseInline, parseMarkdown, Markdown, isJumboEmoji, toPlainText } from '../features/chat/markdown';
import { inOpenCodeBlock } from '../features/common/RichInput';

const U = '11111111-1111-1111-1111-111111111111';
const R = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

describe('inline markdown', () => {
  it('parses bold, italic, underline, strike, spoiler and code', () => {
    const types = parseInline('**b** *i* __u__ ~~s~~ ||x|| `c`').filter((n) => n.t !== 'text').map((n) => n.t);
    expect(types).toEqual(['strong', 'em', 'u', 's', 'spoiler', 'code']);
  });

  it('leaves snake_case and lone asterisks literal', () => {
    expect(parseInline('my_var_name')).toEqual([{ t: 'text', v: 'my_var_name' }]);
    expect(parseInline('2 * 3 * 4').every((n) => n.t === 'text')).toBe(true);
  });

  it('supports _em_ at word boundaries', () => {
    expect(parseInline('say _hi_ now').map((n) => n.t)).toEqual(['text', 'em', 'text']);
  });

  it('does not format inside inline code', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ t: 'code', v: '**not bold**' }]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*literal\\*').map((n) => (n.t === 'text' ? n.v : n.t)).join('')).toBe('*literal*');
  });

  it('parses id mentions, @everyone and glyphs, but not plain #words or emails', () => {
    const nodes = parseInline(`<@${U}> <@&${R}> <#${C}> @everyone <:wave:${U}> #general me@x.io`);
    expect(nodes.filter((n) => n.t !== 'text').map((n) => n.t)).toEqual(['user', 'role', 'channel', 'everyone', 'glyph']);
  });

  it('parses masked links only for http(s) and angle-bracket links', () => {
    expect(parseInline('[site](https://a.io)')[0]).toMatchObject({ t: 'link', href: 'https://a.io', masked: true });
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.t === 'link')).toBe(false);
    expect(parseInline('<https://a.io/x>')[0]).toMatchObject({ t: 'link', href: 'https://a.io/x' });
  });

  it('autolinks without swallowing trailing punctuation', () => {
    const nodes = parseInline('see https://a.io/path.');
    expect(nodes[1]).toMatchObject({ t: 'link', href: 'https://a.io/path' });
    expect(nodes[2]).toEqual({ t: 'text', v: '.' });
  });
});

describe('block markdown', () => {
  it('parses fenced code with a language', () => {
    expect(parseMarkdown('```ts\nconst a = 1;\n```')).toEqual([{ t: 'codeblock', lang: 'ts', v: 'const a = 1;' }]);
  });

  it('parses quotes, headings, subtext and lists', () => {
    const blocks = parseMarkdown('# Title\n> quoted\n-# small\n- a\n- b\n1. one');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'quote', 'subtext', 'list', 'list']);
  });

  it('>>> quotes the rest of the message', () => {
    const [b] = parseMarkdown('>>> line one\nline two');
    expect(b.t).toBe('quote');
  });

  it('keeps an unclosed fence as text', () => {
    expect(parseMarkdown('```js\nno end')[0].t).toBe('p');
  });

  it('opens code blocks mid-line and keeps the text after the closing fence', () => {
    expect(parseMarkdown('look ```a = 1``` and more')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'look ' }] },
      { t: 'codeblock', lang: '', v: 'a = 1' },
      { t: 'p', c: [{ t: 'text', v: 'and more' }] },
    ]);
    expect(parseMarkdown('```py\nx\n```\nafter').map((b) => b.t)).toEqual(['codeblock', 'p']);
  });

  it('takes a language only when a newline follows it, and trims blank edge lines', () => {
    expect(parseMarkdown('```hello world```')).toEqual([{ t: 'codeblock', lang: '', v: 'hello world' }]);
    expect(parseMarkdown('```js\n\n\nx\n\n```')).toEqual([{ t: 'codeblock', lang: 'js', v: 'x' }]);
  });

  it('keeps a code block inside a >>> quote', () => {
    const [q] = parseMarkdown('>>> see\n```js\nx\n```');
    expect(q.t === 'quote' && q.c.map((b) => b.t)).toEqual(['p', 'codeblock']);
  });

  it('nests indented list items', () => {
    const [list] = parseMarkdown('- a\n  - b\n    - c\n- d');
    expect(list.t === 'list' && list.items.length).toBe(2);
    const sub = list.t === 'list' ? list.items[0][1] : null;
    expect(sub?.t === 'list' && sub.items[0][1]?.t).toBe('list');
  });
});

describe('<Markdown />', () => {
  it('resolves user mentions and never renders raw HTML', () => {
    render(
      <Markdown
        content={`hi <@${U}> <img src=x onerror=alert(1)>`}
        resolvers={{ user: () => ({ label: 'kira' }) }}
      />
    );
    expect(screen.getByText('@kira')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it('hides spoilers until clicked', async () => {
    render(<Markdown content="||secret||" />);
    const spoiler = screen.getByRole('button', { name: /spoiler/i });
    spoiler.click();
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('renders links with noopener', () => {
    render(<Markdown content="[docs](https://example.com)" />);
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('rel', 'noreferrer noopener');
  });
});

describe('helpers', () => {
  it('knows when the caret is inside an unclosed code block', () => {
    expect(inOpenCodeBlock('```js\nconst', 11)).toBe(true);
    expect(inOpenCodeBlock('```js\nx\n```', 12)).toBe(false);
    expect(inOpenCodeBlock('```js\nx\n```', 3)).toBe(false);
    expect(inOpenCodeBlock('plain', 5)).toBe(false);
  });

  it('detects emoji-only messages', () => {
    expect(isJumboEmoji('🚀🚀')).toBe(true);
    expect(isJumboEmoji('🚀 launch')).toBe(false);
  });

  it('produces plain-text previews', () => {
    expect(toPlainText(`**hey** <@${U}>`, { user: () => ({ label: 'kira' }) })).toBe('hey @kira');
  });
});

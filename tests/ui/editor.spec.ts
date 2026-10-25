import { test, expect, register, signIn } from './fixtures';

const SHOTS = process.env.EDITOR_SHOTS ? 'screenshots/' : null;

test.describe('Message editor', () => {
  test('emoji show as images at the caret, the picker closes after a pick unless told not to, and what is sent is plain text', async ({ page }) => {
    const me = await register('editor', 'Editor Pilot');
    const { beacon, relays } = await me.api.createBeacon('Editor Beacon');
    const text = relays.find((r) => r.type === 'text')!;
    await signIn(page, me, `/channels/${beacon.id}/${text.id}`);
    const box = page.getByRole('textbox', { name: /^Transmit to #/ });

    // Typed / pasted emoji become images (flags included).
    await box.click();
    await page.keyboard.type('hi ');
    await page.keyboard.insertText('🇺🇸🏳️‍🌈');
    await expect(box.locator('img.rich-emoji')).toHaveCount(2);

    // Picker: inserts at the caret and closes by default.
    await page.keyboard.type(' mid ');
    await page.getByRole('button', { name: 'Select emoji' }).click();
    const picker = page.getByRole('dialog', { name: 'Emoji picker' });
    await expect(picker.getByRole('switch', { name: 'Close after selecting' })).toHaveAttribute('aria-checked', 'true');
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('rocket');
    await picker.getByRole('button', { name: 'rocket', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await page.keyboard.type(' end');
    await expect(box.locator('img.rich-emoji')).toHaveCount(3);

    // Turned off, it stays open for several picks.
    await page.getByRole('button', { name: 'Select emoji' }).click();
    await picker.getByRole('switch', { name: 'Close after selecting' }).click();
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('star');
    await picker.getByRole('button', { name: 'star', exact: true }).click();
    await picker.getByRole('button', { name: 'star', exact: true }).click();
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box.locator('img.rich-emoji')).toHaveCount(5);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}editor-emoji.png` });

    // Shift+Enter is a new line; Enter sends the plain text.
    await box.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line two');
    await page.keyboard.press('Enter');
    const sent = page.getByRole('log').getByRole('article').last();
    await expect(sent).toContainText('mid');
    await expect(sent).toContainText('line two');
    const history = await me.api.get(`/channels/relay/${text.id}/transmissions?limit=1`);
    expect(history.transmissions[0].content).toBe('hi 🇺🇸🏳️‍🌈 mid 🚀 end⭐⭐\nline two');
    await expect(box).toHaveText('');

    // Undo restores what was typed.
    await box.click();
    await page.keyboard.type('oops');
    await page.keyboard.press('Control+z');
    await expect(box).toHaveText('');
  });

  test('previews markdown while typing, keeps Enter as a new line inside code, and an emptied box stays empty', async ({ page }) => {
    const me = await register('preview', 'Preview Pilot');
    const { beacon, relays } = await me.api.createBeacon('Preview Beacon');
    const text = relays.find((r) => r.type === 'text')!;
    await signIn(page, me, `/channels/${beacon.id}/${text.id}`);
    const box = page.getByRole('textbox', { name: /^Transmit to #/ });
    const last = async () => (await me.api.get(`/channels/relay/${text.id}/transmissions?limit=1`)).transmissions[0]?.content;

    // Deleting the only character leaves nothing behind (no stray new line).
    await box.click();
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('y');
    await expect(box).toHaveText('y');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.keyboard.type('after');
    await expect(box).toHaveText('after');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');

    // Spoilers, bold and inline code show while typing, characters kept.
    await page.keyboard.type('a ||secret|| and **loud** and `code`');
    await expect(box.locator('.md-spoiler')).toHaveText('||secret||');
    await expect(box.locator('.md-b')).toHaveText('**loud**');
    await expect(box.locator('.md-code')).toHaveText('`code`');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');

    // A closed code block is coloured in the box; Enter inside it is still a new line.
    await page.keyboard.type('```cpp');
    await page.keyboard.press('Enter');
    await page.keyboard.type('int d = 5;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('```');
    await expect(box.locator('.md-codeblock .hljs-type, .md-codeblock .hljs-keyword').first()).toHaveText('int');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}editor-preview.png` });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('int e = 6;');
    await expect(box).toHaveText('```cpp\nint d = 5;\nint e = 6;\n```');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await expect.poll(last).toBe('```cpp\nint d = 5;\nint e = 6;\n```');

    // Emoji in messages are their own small images, not the picker's sheet.
    await box.click();
    await page.keyboard.insertText('🚀');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log').locator('img[src="/emoji/64/1f680.png"]').last()).toBeVisible();
  });

  test('formatting menu, shortcuts, Enter inside a code block, highlighted code and the leaving-site check', async ({ page }) => {
    const me = await register('format', 'Format Pilot');
    const { beacon, relays } = await me.api.createBeacon('Format Beacon');
    const text = relays.find((r) => r.type === 'text')!;
    await signIn(page, me, `/channels/${beacon.id}/${text.id}`);
    const box = page.getByRole('textbox', { name: /^Transmit to #/ });
    const last = async () => (await me.api.get(`/channels/relay/${text.id}/transmissions?limit=1`)).transmissions[0]?.content;

    // Selecting text shows the menu; Bold wraps it and shows as pressed.
    await box.click();
    await page.keyboard.type('make this loud');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    const bar = page.getByRole('toolbar', { name: 'Text formatting' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Bold' }).click();
    await expect(box).toHaveText('make this **loud**');
    await expect(bar.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}format-menu.png` });
    // Pressing it again unwraps.
    await bar.getByRole('button', { name: 'Bold' }).click();
    await expect(box).toHaveText('make this loud');
    // Ctrl+I italicises the selection.
    await page.keyboard.press('Control+i');
    await expect(box).toHaveText('make this *loud*');
    await page.keyboard.press('End');
    await expect(bar).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect.poll(last).toBe('make this *loud*');

    // While ``` is open, Enter is a new line; after it closes, Enter sends.
    await box.click();
    await page.keyboard.type('```js');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const answer = 42;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('```');
    await expect(box).toHaveText('```js\nconst answer = 42;\n```');
    await page.keyboard.press('Enter');
    await expect.poll(last).toBe('```js\nconst answer = 42;\n```');
    const code = page.getByRole('log').locator('pre[data-lang="js"]').last();
    await expect(code.locator('.hljs-keyword')).toHaveText('const');
    if (SHOTS) {
      await me.api.post(`/channels/relay/${text.id}/transmissions`, {
        content:
          'Before ```inline block``` after\n- top\n  - nested\n    - deeper\n- back\n> quoted with `code`\n```py\ndef long_function_name(argument_one, argument_two, argument_three, argument_four, argument_five):\n    return "a very long string that should wrap rather than scroll sideways in the block"\n```\n<t:1792886400:R>',
      });
      await expect(page.getByRole('log').locator('pre[data-lang="py"] .hljs-keyword').first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}markdown.png` });
    }

    // Outside links ask first.
    await box.click();
    await page.keyboard.type('[docs](https://example.com/guide)');
    await page.keyboard.press('Enter');
    await page.getByRole('log').getByRole('link', { name: 'docs' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leaving Subspace' });
    await expect(dialog).toContainText('https://example.com/guide');
    await dialog.getByRole('button', { name: 'Go Back' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

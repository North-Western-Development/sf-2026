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
});

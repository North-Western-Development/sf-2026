import { test, expect, register, signIn, openAs } from './fixtures';

test.describe('Messaging', () => {
  test('creates a beacon through the UI and transmits a message', async ({ page, me }) => {
    await signIn(page, me);
    await page.getByRole('button', { name: 'Add a Beacon' }).click();
    await page.getByRole('button', { name: 'Create My Own' }).click();
    const name = page.getByLabel(/^Beacon name/);
    await name.fill('Deep Space Nine');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Deep Space Nine' })).toHaveAttribute('aria-current', 'page');
    const composer = page.getByRole('textbox', { name: /^Transmit to #/ });
    await composer.fill('First transmission from the station');
    await composer.press('Enter');
    await expect(page.getByRole('article').filter({ hasText: 'First transmission from the station' })).toBeVisible();
    await expect(composer).toHaveValue('');

    // Persisted, not only optimistic.
    await page.reload();
    await expect(page.getByRole('article').filter({ hasText: 'First transmission from the station' })).toBeVisible();
  });

  test('renders markdown: bold, italics, strike, code, quotes, spoilers, links', async ({ page, me }) => {
    const { beacon, relays } = await me.api.createBeacon('Markdown Beacon');
    const relay = relays.find((r) => r.type === 'text')!;
    await signIn(page, me, `/channels/${beacon.id}/${relay.id}`);
    const composer = page.getByRole('textbox', { name: /^Transmit to #/ });

    await composer.fill('**bold** *italic* ~~gone~~ __under__ `inline()` ||secret|| https://example.com');
    await composer.press('Enter');
    const msg = page.getByRole('article').last();
    await expect(msg.locator('strong', { hasText: 'bold' })).toBeVisible();
    await expect(msg.locator('em', { hasText: 'italic' })).toBeVisible();
    await expect(msg.locator('s', { hasText: 'gone' })).toBeVisible();
    await expect(msg.locator('u', { hasText: 'under' })).toBeVisible();
    await expect(msg.locator('code', { hasText: 'inline()' })).toBeVisible();
    await expect(msg.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('rel', /noopener/);

    const spoiler = msg.getByRole('button', { name: 'Spoiler, activate to reveal' });
    await expect(spoiler).toBeVisible();
    await spoiler.click();
    await expect(msg.getByRole('button', { name: 'Spoiler, activate to reveal' })).toHaveCount(0);

    await composer.fill('> quoted line');
    await composer.press('Enter');
    await expect(page.getByRole('article').last().locator('blockquote')).toContainText('quoted line');

    await composer.fill('```js\nconst x = 1;\n```');
    await composer.press('Enter');
    await expect(page.getByRole('article').last().locator('pre code')).toContainText('const x = 1;');
  });

  test('never renders HTML or javascript: links from message content', async ({ page, me }) => {
    const { beacon, relays } = await me.api.createBeacon('XSS Beacon');
    const relay = relays.find((r) => r.type === 'text')!;
    await me.api.send(relay.id, '<img src=x onerror="window.__xss=1"> [click](javascript:window.__xss=2) <script>window.__xss=3</script>');
    await signIn(page, me, `/channels/${beacon.id}/${relay.id}`);
    const msg = page.getByRole('article').last();
    await expect(msg).toContainText('<img src=x');
    await expect(msg.locator('img[src="x"], script')).toHaveCount(0);
    await expect(msg.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('edits, replies to, reacts to and deletes a message', async ({ page, me }) => {
    const { beacon, relays } = await me.api.createBeacon('Edit Beacon');
    const relay = relays.find((r) => r.type === 'text')!;
    await me.api.send(relay.id, 'original text');
    await signIn(page, me, `/channels/${beacon.id}/${relay.id}`);

    const { id } = (await me.api.get(`/relays/${relay.id}/transmissions`)).transmissions[0];
    const msg = page.locator(`#msg-${id}`);
    await msg.hover();
    await msg.getByRole('button', { name: 'Edit' }).click();
    const editor = msg.getByRole('textbox');
    await editor.fill('edited text');
    await editor.press('Enter');
    await expect(msg).toContainText('(edited)');
    // An edit must not wipe the author (regression: edits replaced the whole message).
    await expect(msg).toHaveAccessibleName(new RegExp(`^${me.transmitter.displayName},`));

    const edited = msg;
    // Own messages keep Reply in the context menu (as Discord does), opened by right-click.
    await edited.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reply' }).click();
    await expect(page.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
    const composer = page.getByRole('textbox', { name: /^Transmit to #/ });
    await composer.fill('this is a reply');
    await composer.press('Enter');
    const reply = page.getByRole('article').filter({ hasText: 'this is a reply' });
    await expect(reply).toContainText('edited text');

    await edited.hover();
    await edited.getByRole('button', { name: 'Add Reaction' }).first().click();
    await page.getByRole('button', { name: /^React with / }).first().click();
    await expect(edited.getByRole('button', { name: /^1 reaction, react with/ })).toBeVisible();

    await reply.hover();
    await reply.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('article').filter({ hasText: 'this is a reply' })).toHaveCount(0);
  });

  test('delivers messages to another member in real time', async ({ page, me, browser }) => {
    const other = await register('crew');
    const { beacon, relays } = await me.api.createBeacon('Live Beacon');
    const relay = relays.find((r) => r.type === 'text')!;
    const { code } = await me.api.createInvite(beacon.id);
    await other.api.acceptInvite(code);

    await signIn(page, me, `/channels/${beacon.id}/${relay.id}`);
    const theirs = await openAs(browser, other, `/channels/${beacon.id}/${relay.id}`);
    // A new member has to accept the rules before the composer appears.
    await expect(theirs.getByText("Accept this beacon's rules to start transmitting.")).toBeVisible();
    await theirs.getByRole('button', { name: 'Complete' }).click();
    const welcome = theirs.getByRole('dialog', { name: 'Welcome to Live Beacon' });
    await expect(welcome.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await welcome.getByRole('checkbox', { name: 'I have read and agree to the rules' }).check();
    await welcome.getByRole('button', { name: 'Submit' }).click();
    await expect(theirs.getByRole('textbox', { name: /^Transmit to #/ })).toBeVisible();

    const composer = page.getByRole('textbox', { name: /^Transmit to #/ });
    await composer.fill('hello over subspace');
    await composer.press('Enter');
    await expect(theirs.getByRole('article').filter({ hasText: 'hello over subspace' })).toBeVisible();

    // Typing indicator reaches the other side too.
    await theirs.getByRole('textbox', { name: /^Transmit to #/ }).pressSequentially('typing...', { delay: 50 });
    await expect(page.getByText(/is typing/)).toBeVisible();
    await theirs.context().close();
  });
});

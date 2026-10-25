import { PNG } from '../support/mock-drives';
import { test, expect, register, signIn, openAs } from './fixtures';

const SHOTS = process.env.COMMUNITY_SHOTS ? 'screenshots/' : null;
/** A valid PNG for the cover image. */
const COVER = PNG;

test.describe('Events, Channels & Roles, and the Members page', () => {
  test('the owner schedules an event; a member marks interest and sees it go live', async ({ page, browser }) => {
    const owner = await register('evhost', 'Event Host');
    const guest = await register('evguest', 'Event Guest');
    const { beacon, relays } = await owner.api.createBeacon('Event Beacon');
    const text = relays.find((r) => r.type === 'text')!;
    await guest.api.join(beacon.id, (await owner.api.createInvite(beacon.id)).code);
    await signIn(page, owner, `/channels/${beacon.id}/${text.id}`);

    const nav = page.getByRole('navigation', { name: 'Relays' });
    await nav.getByRole('button', { name: /^Events/ }).click();
    const events = page.getByRole('dialog').filter({ hasText: 'There are no upcoming events.' });
    await events.getByRole('button', { name: 'Create Event' }).click();

    // Step 1: where. Step 2: what and when. Step 3: preview.
    let wizard = page.getByRole('dialog', { name: 'Where is your event?' });
    await expect(wizard.getByRole('radio', { name: /Comm-Link/ })).toHaveAttribute('aria-checked', 'true');
    await expect(wizard.getByRole('radio', { name: /Stage/ })).toBeDisabled();
    await expect(wizard.getByRole('combobox', { name: /Select a Comm-Link/ })).toContainText('General');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}events-location.png` });
    await wizard.getByRole('button', { name: 'Next' }).click();
    wizard = page.getByRole('dialog', { name: "What's your event about?" });
    await wizard.getByRole('textbox', { name: 'Event Topic' }).fill('Raid Night');
    await wizard.getByRole('textbox', { name: 'Description' }).fill('Bring snacks.');
    await wizard.getByRole('combobox', { name: /Event Frequency/ }).click();
    await wizard.getByRole('option', { name: /^Weekly on / }).click();
    // Cover image: pick a file, crop it in Edit Image, apply.
    const chooser = page.waitForEvent('filechooser');
    await wizard.getByRole('button', { name: 'Upload Cover Image' }).click();
    await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: COVER });
    const crop = page.getByRole('dialog', { name: 'Edit Image' });
    await crop.getByRole('slider', { name: 'Zoom' }).fill('1.5');
    await crop.getByRole('button', { name: 'Rotate' }).click();
    await crop.getByRole('button', { name: 'Apply' }).click();
    await expect(wizard.getByRole('img', { name: 'Cover' })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}events-details.png` });
    await wizard.getByRole('button', { name: 'Next' }).click();
    wizard = page.getByRole('dialog', { name: "Here's a preview of your event" });
    await expect(wizard.getByRole('article', { name: 'Raid Night' })).toBeVisible();
    await expect(wizard).toContainText('Repeats weekly');
    await expect(wizard).toContainText('This event will auto start');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}events-preview.png` });
    await wizard.getByRole('button', { name: 'Create Event' }).click();

    const list = page.getByRole('dialog').filter({ has: page.getByRole('list', { name: 'Events' }) });
    const card = list.getByRole('article', { name: 'Raid Night' });
    await expect(card).toContainText('Bring snacks.');
    await expect(card.getByLabel('1 interested')).toBeVisible();
    await expect(nav.getByRole('button', { name: /^1 Event/ })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}events-list.png` });

    // The guest sees it live (gateway), marks interest, and is told when it starts.
    const theirs = await openAs(browser, guest, `/channels/${beacon.id}/${text.id}`);
    const theirNav = theirs.getByRole('navigation', { name: 'Relays' });
    await expect(theirNav.getByRole('button', { name: /^1 Event/ })).toBeVisible();
    await theirNav.getByRole('button', { name: /^1 Event/ }).click();
    const theirCard = theirs.getByRole('article', { name: 'Raid Night' });
    await expect(theirCard.getByRole('button', { name: 'Start' })).toHaveCount(0);
    await theirCard.getByRole('button', { name: 'Interested' }).click();
    await expect(theirCard.getByRole('button', { name: 'Interested' })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByLabel('2 interested')).toBeVisible();

    await card.getByRole('button', { name: 'Start' }).click();
    await expect(card).toContainText('Happening now');
    await expect(theirs.getByText('Raid Night is starting now')).toBeVisible();
    await expect(theirNav.getByText('Live')).toBeVisible();
    await theirs.context().close();
  });

  test('questions grant clearances and show relays; members hide relays from their own sidebar', async ({ page, browser }) => {
    const owner = await register('crowner', 'CR Owner');
    const member = await register('crmember', 'CR Member');
    const { beacon, relays } = await owner.api.createBeacon('Roles Beacon');
    const text = relays.find((r) => r.type === 'text')!;
    const zomboid = (await owner.api.post(`/beacons/${beacon.id}/relays`, { name: 'zomboid-chat', type: 'text' })).relay;
    const role = (await owner.api.post(`/beacons/${beacon.id}/clearances`, { name: 'Zomboid', position: 1, permissions: '0', color: '#e5484d' })).clearance;
    await member.api.join(beacon.id, (await owner.api.createInvite(beacon.id)).code);

    // The owner writes a question in beacon settings.
    await signIn(page, owner, `/channels/${beacon.id}/${text.id}`);
    await page.locator('aside button').filter({ hasText: 'Roles Beacon' }).first().click();
    await page.getByRole('menuitem', { name: /Beacon Settings/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Onboarding', exact: true }).click();
    const editor = page.getByRole('region', { name: 'Customization questions' });
    await editor.getByRole('button', { name: 'Add Question' }).click();
    await editor.getByRole('textbox', { name: 'Question 1', exact: true }).fill('What games do you want to play?');
    await editor.getByRole('textbox', { name: 'Answer 1', exact: true }).fill('Zomboid');
    await editor.getByRole('button', { name: 'Pick an emoji for answer 1' }).click();
    await page.getByRole('dialog', { name: 'Emoji picker' }).getByRole('textbox', { name: 'Search emoji' }).fill('zombie');
    await page.getByRole('dialog', { name: 'Emoji picker' }).getByRole('button', { name: /^zombie/ }).first().click();
    await editor.getByRole('button', { name: /Give clearances/ }).click();
    await page.getByRole('menuitem', { name: 'Zomboid' }).click();
    await editor.getByRole('button', { name: /Show relays/ }).click();
    await page.getByRole('menuitem', { name: 'zomboid-chat' }).click();
    await editor.getByRole('button', { name: 'Save Questions' }).click();
    await expect(page.getByText('Questions saved')).toBeVisible();

    // The member hides zomboid-chat, then answering the question brings it back with the clearance.
    const theirs = await openAs(browser, member, `/channels/${beacon.id}/${text.id}`);
    const sidebar = theirs.getByRole('navigation', { name: 'Relays' });
    await sidebar.getByRole('button', { name: 'Channels & Roles' }).click();
    await theirs.getByRole('button', { name: /^Browse Channels/ }).click();
    await theirs.getByRole('checkbox', { name: 'Show zomboid-chat' }).uncheck();
    await expect(sidebar.getByRole('link', { name: /^zomboid-chat/ })).toHaveCount(0);
    // Its band (here the unbanded relays) is no longer followed as a whole.
    await expect(theirs.getByRole('switch', { name: 'Follow other relays' })).toHaveAttribute('aria-checked', 'false');
    if (SHOTS) await theirs.screenshot({ path: `${SHOTS}channels-browse.png` });

    await theirs.getByRole('button', { name: 'Customize' }).click();
    await theirs.getByRole('checkbox', { name: /Zomboid/ }).click();
    await expect(theirs.getByRole('checkbox', { name: /Zomboid/ })).toHaveAttribute('aria-checked', 'true');
    await expect(theirs.getByRole('complementary', { name: 'My profile' })).toContainText('Zomboid');
    await expect(sidebar.getByRole('link', { name: /^zomboid-chat/ })).toBeVisible();
    if (SHOTS) await theirs.screenshot({ path: `${SHOTS}channels-customize.png` });

    // The owner sees the clearance on the member.
    await expect.poll(async () => (await owner.api.get(`/beacons/${beacon.id}/members`)).members.find((m: any) => m.transmitterId === member.transmitter.id)?.clearanceIds).toContain(role.id);
    void zomboid;
    await theirs.context().close();
  });

  test('the Members page lists join details for moderators and is hidden from everyone else', async ({ page, browser }) => {
    const owner = await register('mbowner', 'MB Owner');
    const member = await register('mbmember', 'MB Member', { verified: false });
    const { beacon, relays } = await owner.api.createBeacon('Members Beacon');
    const text = relays.find((r) => r.type === 'text')!;
    const { code } = await owner.api.createInvite(beacon.id);
    await member.api.join(beacon.id, code);

    await signIn(page, owner, `/channels/${beacon.id}/${text.id}`);
    await page.getByRole('navigation', { name: 'Relays' }).getByRole('button', { name: 'Members' }).click();
    await expect(page).toHaveURL(/member-safety$/);
    const row = page.getByRole('row').filter({ hasText: 'MB Member' });
    await expect(row).toContainText(code);
    await expect(row.getByRole('img', { name: 'Email not verified' })).toBeVisible();
    await expect(row.getByRole('img', { name: /New account/ })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'MB Owner' })).toContainText('Created it');
    await page.getByRole('textbox', { name: 'Search members' }).fill('mbowner');
    await expect(page.getByRole('row').filter({ hasText: 'MB Member' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Search members' }).fill('');
    await page.getByRole('button', { name: 'Prune' }).click();
    await expect(page.getByRole('dialog', { name: 'Prune members' })).toContainText('0 members would be removed');
    await page.keyboard.press('Escape');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}members-page.png` });

    const theirs = await openAs(browser, member, `/channels/${beacon.id}/${text.id}`);
    await expect(theirs.getByRole('navigation', { name: 'Relays' }).getByRole('button', { name: 'Members' })).toHaveCount(0);
    await theirs.goto(`/channels/${beacon.id}/member-safety`);
    await expect(theirs).not.toHaveURL(/member-safety$/);
    await theirs.context().close();
  });
});

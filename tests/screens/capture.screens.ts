import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect, register, signIn, openAs, promoteToStaff, MAIL_DIR, waitForMailFile, PASSWORD, type Session } from '../ui/fixtures';
import type { Browser, Page } from '@playwright/test';
import { art, avatarArt, bannerArt, photoArt, call, uploadMedia, uploadVault, totp } from './world';

/**
 * A picture of every screen. Seeds a small, realistic world on the browser-test stack, then
 * walks the app. Each screen is a soft step: a failure is logged and the walk continues.
 */

const OUT = path.resolve(__dirname, '../../screenshots/web');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
const failures: string[] = [];

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.waitForTimeout(450);
  const file = path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage });
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message.split('\n')[0]}`);
    console.log(`SKIPPED ${name}: ${(err as Error).message.split('\n')[0]}`);
  }
}

const esc = (page: Page) => page.keyboard.press('Escape');

// A fake website for a link preview.
let site: http.Server;
let siteOrigin = '';

interface World {
  nova: Session;
  ion: Session;
  kepler: Session;
  lyra: Session;
  orion: Session;
  beaconId: string;
  generalId: string;
  announcementsId: string;
  forumId: string;
  galleryId: string;
  commId: string;
  loungeId: string;
  dmIonId: string;
  dmKeplerId: string;
  meshId: string;
  inviteCode: string;
  pinnedId: string;
}

async function seed(browser: Browser): Promise<World> {
  const nova = await register('nova', 'Nova Prime');
  const ion = await register('ion', 'Ion Vega');
  const kepler = await register('kepler', 'Kepler Rhee');
  const lyra = await register('lyra', 'Lyra Sol');
  const orion = await register('orion', 'Orion Hale');
  await promoteToStaff(nova, 3);

  const profiles: Array<[Session, string, [string, string], string, string]> = [
    [nova, avatarArt.nova, ['#3b8ef2', '#fff36b'], 'Captain of the *Andromeda Station*. Ask me about warp theory.', 'she/her'],
    [ion, avatarArt.ion, ['#3dcbff', '#3353d6'], 'Navigation officer. Maps, routes and **star charts**.', 'he/him'],
    [kepler, avatarArt.kepler, ['#ff8fd8', '#7b3df0'], 'Exobiologist. Collecting samples from every moon.', 'they/them'],
    [lyra, avatarArt.lyra, ['#a3ff8f', '#1f9e6a'], 'Comms engineer on the night shift.', 'she/they'],
    [orion, avatarArt.orion, ['#ffb07d', '#c2410c'], 'Freighter pilot between the outer colonies.', 'he/him'],
  ];
  for (const [s, avatar, [a, b], bio, pronouns] of profiles) {
    const avatarUrl = await uploadMedia(s, 'avatar', await art(browser, avatar, 256, 256));
    const bannerUrl = await uploadMedia(s, 'banner', await art(browser, bannerArt(a, b), 960, 340));
    await call(s, 'PATCH', '/users/@me/profile', { avatarUrl, bannerUrl, bio, pronouns });
  }
  await call(nova, 'PATCH', '/users/@me/status', { customStatus: { text: 'Charting the Orion Arm', emoji: '🔭' } });
  await call(ion, 'PATCH', '/users/@me/status', { customStatus: { text: 'On the bridge', emoji: '🛰️' } });

  await nova.api.befriend(ion);
  await nova.api.befriend(kepler);
  await call(lyra, 'POST', '/affiliations/request', { targetId: nova.transmitter.id, greetingNote: 'Met you at the comms briefing!' });
  await call(nova, 'POST', '/affiliations/request', { targetId: orion.transmitter.id });

  // The main beacon.
  const icon = await uploadMedia(nova, 'beacon_icon', await art(browser, avatarArt.ion.replace('#0b1f24', '#09122b'), 256, 256));
  const banner = await uploadMedia(nova, 'beacon_banner', await art(browser, bannerArt('#3b8ef2', '#7b3df0'), 960, 540));
  const { beacon } = await call(nova, 'POST', '/beacons', {
    name: 'Andromeda Station',
    description: 'Home port for explorers of the Andromeda sector. Maps, missions and late-night comms.',
    iconUrl: icon,
    bannerUrl: banner,
    isDiscoverable: true,
    rulesText: '1. Respect every transmitter.\n2. Keep coordinates of private colonies private.\n3. Spoilers for new discoveries go in ||spoiler tags||.',
  });
  const beaconId = beacon.id;
  const { relays } = await call(nova, 'GET', `/beacons/${beaconId}/relays`);
  const generalId = relays.find((r: any) => r.type === 'text').id;
  const commId = relays.find((r: any) => r.type === 'comm_link').id;
  await call(nova, 'PATCH', `/beacons/${beaconId}/relays/${generalId}`, { topic: 'Station-wide chatter. Mission briefings live in #announcements.' });
  const announcementsId = (await call(nova, 'POST', `/beacons/${beaconId}/relays`, { name: 'announcements', type: 'text' })).relay.id;
  const forumId = (await call(nova, 'POST', `/beacons/${beaconId}/relays`, { name: 'expedition-logs', type: 'archival' })).relay.id;
  const galleryId = (await call(nova, 'POST', `/beacons/${beaconId}/relays`, { name: 'nebula-shots', type: 'visual' })).relay.id;

  const roles: Array<[string, string]> = [
    ['Captain', '#fff36b'],
    ['Navigator', '#3dcbff'],
    ['Science', '#ff8fd8'],
  ];
  const roleIds: string[] = [];
  for (const [name, color] of roles) {
    const { clearance } = await call(nova, 'POST', `/beacons/${beaconId}/clearances`, { name, color });
    await call(nova, 'PATCH', `/beacons/${beaconId}/clearances/${clearance.id}`, { hoist: true });
    roleIds.push(clearance.id);
  }
  const { invite } = await call(nova, 'POST', `/beacons/${beaconId}/invites`, {});
  for (const s of [ion, kepler, lyra]) await s.api.join(beaconId, invite.code);
  await call(nova, 'POST', `/beacons/${beaconId}/clearances/members/${nova.transmitter.id}/assign`, { clearanceId: roleIds[0], action: 'add' });
  await call(nova, 'POST', `/beacons/${beaconId}/clearances/members/${ion.transmitter.id}/assign`, { clearanceId: roleIds[1], action: 'add' });
  await call(nova, 'POST', `/beacons/${beaconId}/clearances/members/${kepler.transmitter.id}/assign`, { clearanceId: roleIds[2], action: 'add' });

  // Conversation in #general, with markdown, mentions, a reply, reactions, a preview and an image.
  const say = (s: Session, content: string, extra: Record<string, unknown> = {}) =>
    call(s, 'POST', `/channels/relay/${generalId}/transmissions`, { content, ...extra }).then((r) => r.transmission);
  await say(nova, 'Morning crew! **Jump window** opens at 0900 station time. Final checks in #announcements.');
  const q = await say(ion, `Route plotted through the *Veil Nebula*. <@${nova.transmitter.id}> want the scenic pass or the fast one?`);
  await say(nova, 'Scenic, obviously. We have time. 🌌', { replyToId: q.id });
  await say(kepler, `Sample notes from Titan-B are up: ${siteOrigin}/titan-b`);
  const photo = await uploadVault(kepler, 'titan-b-surface.png', 'image/png', await art(browser, photoArt('#ff8fd8', '#3b8ef2', '#fff36b'), 900, 560));
  await say(kepler, 'Surface scan from this morning:', { attachmentIds: [photo] });
  const pin = await say(lyra, 'Reminder: comms blackout from 2200 to 2300 for the relay upgrade. ||Bring snacks.||');
  await say(ion, '```\nheading 214.7  velocity 0.82c  eta 03:12:44\n```');
  await say(nova, 'Thanks all. See you on the bridge.');
  await call(nova, 'PUT', `/transmissions/${pin.id}/pin`);
  for (const [s, emoji] of [[ion, '🚀'], [kepler, '🚀'], [lyra, '❤️']] as const) await call(s, 'PUT', `/transmissions/${q.id}/reactions/${encodeURIComponent(emoji)}/@me`);
  await call(nova, 'POST', `/channels/relay/${announcementsId}/transmissions`, { content: '# Mission 42\nDeparture **0900**. Bring your badge.' });

  // Forum posts.
  for (const [s, title, content, tags] of [
    [ion, 'Mapping the Veil Nebula', 'Day 3. The dust lanes are thicker than the survey suggested.', ['navigation']],
    [kepler, 'Titan-B microbial mats', 'Photos and readings from the northern trench.', ['science', 'samples']],
    [nova, 'Station maintenance schedule', 'Who is on the reactor rota this week?', ['ops']],
  ] as const) {
    await call(s, 'POST', `/relays/${forumId}/archival/threads`, { title, content, tags });
  }

  // A second beacon (for the rail) and a folder.
  const lounge = await call(kepler, 'POST', '/beacons', { name: 'Kepler Lounge', iconUrl: await uploadMedia(kepler, 'beacon_icon', await art(browser, avatarArt.kepler, 256, 256)) });
  const loungeInvite = (await call(kepler, 'POST', `/beacons/${lounge.beacon.id}/invites`, {})).invite.code;
  await nova.api.join(lounge.beacon.id, loungeInvite);
  const third = await call(orion, 'POST', '/beacons', { name: 'Outer Colonies', isDiscoverable: true, description: 'Freight, trade routes and colony news.' });
  const outer = (await call(orion, 'POST', `/beacons/${third.beacon.id}/invites`, {})).invite.code;
  await nova.api.join(third.beacon.id, outer);
  await call(nova, 'POST', '/clusters', { name: 'Hangouts', color: '#3b8ef2', beaconIds: [lounge.beacon.id, third.beacon.id] });

  // Direct links and a mesh.
  const dmIon = (await ion.api.openDm(nova, 'Hey, did you see the new star chart?')).linkId;
  await call(nova, 'POST', `/channels/link/${dmIon}/transmissions`, { content: 'Just now. The Orion Arm overlay is beautiful.' });
  await call(ion, 'POST', `/channels/link/${dmIon}/transmissions`, { content: 'Took me all night 😅 Want to go over it on a call later?' });
  const dmKepler = (await kepler.api.openDm(nova, 'Lab results are in.')).linkId;
  const { mesh } = await call(nova, 'POST', '/meshes', { name: 'Away Team', memberIds: [ion.transmitter.id, kepler.transmitter.id] });
  await call(nova, 'POST', `/meshes/${mesh.id}/transmissions`, { content: 'Away team, gear check at 0830.' }).catch(() =>
    call(nova, 'POST', `/channels/mesh/${mesh.id}/transmissions`, { content: 'Away team, gear check at 0830.' })
  );
  await call(ion, 'POST', `/channels/mesh/${mesh.id}/transmissions`, { content: 'Suit pressure checked ✅' });
  // A message request from someone who is not a friend.
  await call(lyra, 'POST', `/links/${nova.transmitter.id}/transmissions`, { content: 'Hi Nova! Could I join the next survey flight?' }).catch(() => {});

  return {
    nova, ion, kepler, lyra, orion,
    beaconId, generalId, announcementsId, forumId, galleryId, commId,
    loungeId: lounge.beacon.id, dmIonId: dmIon, dmKeplerId: dmKepler, meshId: mesh.id,
    inviteCode: invite.code, pinnedId: pin.id,
  };
}

test.beforeAll(async () => {
  site = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><meta property="og:title" content="Titan-B Field Notes"><meta property="og:description" content="Microbial mats, ice temperature and a strange green glow in the northern trench."><meta property="og:site_name" content="Kepler Lab Wiki"><meta name="theme-color" content="#ff8fd8"></head></html>');
  });
  await new Promise<void>((r) => site.listen(0, 'localhost', r));
  siteOrigin = `http://localhost:${(site.address() as AddressInfo).port}`;
});
test.afterAll(() => site.close());

test('capture every screen', async ({ browser }) => {
  const w = await seed(browser);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();

  // ---- Signed out ---------------------------------------------------------------------
  await step('sign in', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await shot(page, 'auth-sign-in');
  });
  await step('register', async () => {
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.waitForTimeout(300);
    await shot(page, 'auth-register');
  });
  await step('two-factor', async () => {
    const tf = await register('secure', 'Secure Pilot');
    const { secret } = await call(tf, 'POST', '/auth/2fa/setup');
    await call(tf, 'POST', '/auth/2fa/verify', { token: tf.accessToken, code: totp(secret) });
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const p = await other.newPage();
    await p.goto('/');
    await p.getByLabel('Email or tag').fill(tf.transmitter.email);
    await p.getByLabel('Password').fill(PASSWORD);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.waitForTimeout(800);
    await shot(p, 'auth-two-factor');
    await other.close();
  });
  await step('account disabled', async () => {
    const d = await register('dormant', 'Dormant Pilot');
    await call(d, 'POST', '/auth/me/disable', { password: PASSWORD });
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const p = await other.newPage();
    await p.goto('/');
    await p.getByLabel('Email or tag').fill(d.transmitter.email);
    await p.getByLabel('Password').fill(PASSWORD);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(p.getByRole('heading', { name: 'Account Disabled' })).toBeVisible();
    await shot(p, 'auth-account-disabled');
    await other.close();
  });
  await step('email verified', async () => {
    const v = await register('verify', 'Verify Pilot', { verified: false });
    const since = Date.now();
    await call(v, 'POST', '/auth/verify-email/resend');
    const mail = await waitForMailFile(MAIL_DIR, v.transmitter.email, /Verify/, { since });
    const link = /https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_-]+/.exec(mail.text)![0];
    await page.goto(new URL(link).pathname + new URL(link).search);
    await expect(page.getByRole('heading', { name: 'Email Verified!' })).toBeVisible();
    await shot(page, 'auth-email-verified');
    await page.goto('/verify-email?token=used-or-invalid-token-0000000');
    await expect(page.getByRole('heading', { name: 'Verification Failed' })).toBeVisible();
    await shot(page, 'auth-email-link-failed');
  });
  await step('directives gate', async () => {
    const res = await fetch('http://localhost:4173/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: `rules_${Date.now().toString(36)}`, email: `rules_${Date.now()}@ui-test.subspace`, password: PASSWORD, displayName: 'Rules Pilot', acceptDirectives: false }),
    }).then((r) => r.json());
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const p = await other.newPage();
    await p.addInitScript((s) => {
      localStorage.setItem('subspace_access_token', s.accessToken);
      localStorage.setItem('subspace_refresh_token', s.refreshToken);
      localStorage.setItem('subspace_user', JSON.stringify(s.transmitter));
    }, res);
    await p.goto('/');
    await p.waitForTimeout(1200);
    await shot(p, 'auth-directives');
    await other.close();
  });
  await step('invite page signed out', async () => {
    await page.goto(`/invite/${w.inviteCode}`);
    await page.waitForTimeout(1200);
    await shot(page, 'invite-signed-out');
  });

  // ---- Signed in as Nova -------------------------------------------------------------
  await signIn(page, w.nova, '/channels/@me');
  // Kepler's browser registers an encryption device (needed for the encrypted DM).
  const keplerPage = await openAs(browser, w.kepler, `/channels/@me/${w.dmKeplerId}`);
  const ionPage = await openAs(browser, w.ion, `/channels/@me/${w.dmIonId}`);
  await ionPage.context().grantPermissions(['microphone', 'camera']);

  await step('friends online', async () => {
    await page.goto('/channels/@me');
    await page.waitForTimeout(800);
    await shot(page, 'home-friends-online');
  });
  for (const tab of ['All', 'Pending']) {
    await step(`friends ${tab}`, async () => {
      await page.getByRole('navigation', { name: /filters/ }).getByRole('button', { name: new RegExp(`^${tab}`) }).click();
      await shot(page, `home-friends-${tab.toLowerCase()}`);
    });
  }
  await step('add friend', async () => {
    await page.getByRole('navigation', { name: /filters/ }).getByRole('button', { name: /Add/ }).click();
    await shot(page, 'home-add-friend');
  });
  await step('message requests', async () => {
    await page.goto('/channels/@me/requests');
    await page.waitForTimeout(800);
    await shot(page, 'home-message-requests');
  });
  await step('discover', async () => {
    await page.goto('/discover');
    await page.waitForTimeout(1000);
    await shot(page, 'discover');
  });
  await step('dm', async () => {
    await page.goto(`/channels/@me/${w.dmIonId}`);
    await expect(page.getByRole('log')).toContainText('Took me all night');
    await shot(page, 'dm-conversation');
  });
  await step('mesh', async () => {
    await page.goto(`/channels/@me/${w.meshId}`);
    await page.waitForTimeout(800);
    await shot(page, 'dm-group-mesh');
  });
  await step('encrypted dm', async () => {
    await page.goto(`/channels/@me/${w.dmKeplerId}`);
    await page.getByRole('button', { name: 'Turn On Encryption' }).click();
    await shot(page, 'dm-turn-on-encryption');
    await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
    await expect(page.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();
    const composer = page.getByRole('textbox', { name: /^Transmit to @/ });
    await composer.fill('Only we can read this. Sample coordinates: 41.2N, 112.7E.');
    await composer.press('Enter');
    await expect(keplerPage.getByRole('log')).toContainText('Sample coordinates', { timeout: 20_000 });
    const kc = keplerPage.getByRole('textbox', { name: /^Transmit to @/ });
    await kc.fill('Got it. Keeping it off the station logs 🔒');
    await kc.press('Enter');
    await expect(page.getByRole('log')).toContainText('off the station logs', { timeout: 20_000 });
    await shot(page, 'dm-encrypted');
    await page.getByRole('button', { name: 'End-to-End Encrypted' }).click();
    await page.waitForTimeout(800);
    await shot(page, 'dm-safety-numbers');
    await esc(page);
  });
  await step('dm call', async () => {
    await page.goto(`/channels/@me/${w.dmIonId}`);
    await page.getByRole('button', { name: 'Start Video Call' }).click();
    const prompt = ionPage.getByRole('alertdialog', { name: /^Incoming call from / });
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await shot(page, 'dm-call-ringing');
    await shot(ionPage, 'dm-call-incoming');
    await prompt.getByRole('button', { name: 'Accept with Video' }).click();
    await expect(page.getByRole('region', { name: 'Call' }).getByRole('group', { name: 'Ion Vega' }).locator('video')).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'dm-call-video');
    await page.getByRole('region', { name: 'Call' }).getByRole('button', { name: 'Leave Call' }).click();
    await ionPage.getByRole('region', { name: 'Call' }).getByRole('button', { name: 'Leave Call' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'dm-call-ended');
  });

  // ---- The beacon -------------------------------------------------------------------
  const base = `/channels/${w.beaconId}`;
  await step('text relay', async () => {
    await page.goto(`${base}/${w.generalId}`);
    await expect(page.getByRole('article', { name: /Link preview/ })).toBeVisible({ timeout: 20_000 });
    await shot(page, 'beacon-text-relay');
  });
  await step('profile popout', async () => {
    await page.getByRole('complementary', { name: 'Members' }).getByRole('button', { name: /Ion Vega/ }).click();
    await shot(page, 'beacon-profile-popout');
    await esc(page);
  });
  await step('full profile', async () => {
    await page.getByRole('complementary', { name: 'Members' }).getByRole('button', { name: /Kepler Rhee/ }).click();
    await page.getByRole('button', { name: /View Full Profile/ }).click();
    await shot(page, 'profile-full');
    await esc(page);
  });
  await step('member menu', async () => {
    await page.getByRole('complementary', { name: 'Members' }).getByRole('button', { name: /Lyra Sol/ }).click({ button: 'right' });
    await shot(page, 'menu-member');
    await esc(page);
  });
  await step('message menu', async () => {
    await page.getByRole('log').getByRole('article').filter({ hasText: 'Route plotted' }).first().click({ button: 'right' });
    await shot(page, 'menu-transmission');
    await esc(page);
  });
  await step('emoji picker', async () => {
    const msg = page.getByRole('log').getByRole('article').filter({ hasText: 'See you on the bridge' });
    await msg.hover();
    await msg.getByRole('button', { name: /Add Reaction/ }).click();
    await shot(page, 'emoji-picker');
    await esc(page);
  });
  await step('reply composer', async () => {
    const msg = page.getByRole('log').getByRole('article').filter({ hasText: 'See you on the bridge' });
    await msg.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reply', exact: true }).click();
    await page.getByRole('textbox', { name: /^Transmit to #/ }).fill(`On my way <@${w.ion.transmitter.id}>`);
    await shot(page, 'composer-reply');
    await page.getByRole('textbox', { name: /^Transmit to #/ }).fill('@');
    await shot(page, 'composer-mention-suggestions');
    await page.getByRole('textbox', { name: /^Transmit to #/ }).fill('');
    await esc(page);
  });
  await step('pins', async () => {
    await page.getByRole('button', { name: 'Pinned Transmissions' }).click();
    await shot(page, 'beacon-pins');
    await esc(page);
  });
  await step('search', async () => {
    const box = page.getByRole('combobox', { name: 'Search' });
    await box.click();
    await shot(page, 'search-options');
    await box.fill('from:');
    await shot(page, 'search-from-suggestions');
    await box.fill('route');
    await box.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Search results' })).toBeVisible();
    await shot(page, 'search-results');
    await page.getByRole('button', { name: 'Close search' }).click();
  });
  await step('notification settings', async () => {
    await page.getByRole('button', { name: 'Notification Settings' }).click();
    await shot(page, 'menu-relay-notifications');
    await esc(page);
  });
  await step('beacon menu', async () => {
    await page.locator('aside button').filter({ hasText: 'Andromeda Station' }).first().click();
    await shot(page, 'menu-beacon-header');
    await esc(page);
  });
  await step('rail menu', async () => {
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /^Andromeda Station/ }).click({ button: 'right' });
    await shot(page, 'menu-beacon-rail');
    await esc(page);
  });
  await step('relay menu', async () => {
    await page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /announcements/ }).click({ button: 'right' });
    await shot(page, 'menu-relay');
    await esc(page);
  });
  await step('invite modal', async () => {
    await page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /general/ }).hover();
    await page.getByRole('button', { name: 'Create Invite' }).first().click();
    await shot(page, 'modal-invite');
    await esc(page);
  });
  await step('beacon notification modal', async () => {
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /^Andromeda Station/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Notification Settings' }).click();
    await shot(page, 'modal-beacon-notifications');
    await esc(page);
  });
  await step('create relay', async () => {
    await page.locator('aside button').filter({ hasText: 'Andromeda Station' }).first().click();
    await page.getByRole('menuitem', { name: /Create Relay/ }).click();
    await shot(page, 'modal-create-relay');
    await esc(page);
  });
  await step('create beacon', async () => {
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /Add a Beacon|Create Beacon/ }).click();
    await shot(page, 'modal-create-beacon');
    await esc(page);
  });
  await step('quick scan', async () => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('an');
    await shot(page, 'modal-quick-scan');
    await esc(page);
  });
  await step('announcements', async () => {
    await page.goto(`${base}/${w.announcementsId}`);
    await page.waitForTimeout(800);
    await shot(page, 'beacon-announcements');
  });
  await step('forum', async () => {
    await page.goto(`${base}/${w.forumId}`);
    await page.waitForTimeout(1000);
    await shot(page, 'beacon-forum');
    await page.getByRole('button', { name: /Mapping the Veil Nebula/ }).first().click();
    await page.waitForTimeout(1000);
    await shot(page, 'beacon-forum-post');
  });
  await step('gallery', async () => {
    await page.goto(`${base}/${w.galleryId}`);
    for (const [name, colors] of [
      ['Horsehead Nebula', ['#ff6b8f', '#3b8ef2', '#fff36b']],
      ['Pillars at dawn', ['#ffb07d', '#7b3df0', '#3dcbff']],
      ['Ice ring', ['#3dcbff', '#e6e6e6', '#3353d6']],
      ['Twin suns', ['#fff36b', '#ff8a3d', '#ff6b8f']],
    ] as const) {
      await page.getByLabel('Choose media to upload').setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: await art(browser, photoArt(...colors), 960, 640) });
      const dialog = page.getByRole('dialog', { name: /^Upload to #/ });
      await dialog.getByLabel('Caption').fill(name);
      await dialog.getByRole('button', { name: 'Upload' }).click();
      await page.waitForTimeout(400);
      const notice = page.getByRole('dialog', { name: 'Before you upload' });
      if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: 'I understand' }).click();
      await expect(dialog).toHaveCount(0);
    }
    await page.waitForTimeout(800);
    await shot(page, 'beacon-gallery');
    await page.getByRole('list', { name: /Media in/ }).getByRole('button', { name: 'Horsehead Nebula' }).click();
    await shot(page, 'beacon-gallery-viewer');
    await esc(page);
  });
  await step('comm-link empty', async () => {
    await page.goto(`${base}/${w.commId}`);
    await page.waitForTimeout(800);
    await shot(page, 'beacon-comm-link-empty');
  });
  await step('comm-link live', async () => {
    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('main').getByRole('button', { name: 'Turn On Camera' }).click();
    await ionPage.goto(`${base}/${w.commId}`);
    await ionPage.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('group', { name: 'Ion Vega' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await shot(page, 'beacon-comm-link-live');
    await page.getByRole('button', { name: 'Toggle chat' }).click();
    await shot(page, 'beacon-comm-link-chat');
    await page.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
    await ionPage.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
  });

  // ---- Beacon settings ---------------------------------------------------------------
  await step('beacon settings', async () => {
    await page.goto(`${base}/${w.generalId}`);
    await page.locator('aside button').filter({ hasText: 'Andromeda Station' }).first().click();
    await page.getByRole('menuitem', { name: /Beacon Settings/ }).click();
    await shot(page, 'beacon-settings-overview');
    for (const tab of ['Clearances', 'Signal Glyphs', 'Invites', 'Bans', 'Onboarding']) {
      await step(`beacon settings ${tab}`, async () => {
        await page.getByRole('dialog').getByRole('button', { name: tab, exact: true }).click();
        await shot(page, `beacon-settings-${tab.toLowerCase().replace(/\s+/g, '-')}`);
        if (tab === 'Clearances') {
          await page.getByRole('dialog').getByRole('button', { name: /Navigator/ }).first().click();
          await shot(page, 'beacon-settings-clearance-edit');
        }
      });
    }
    await step('relay settings', async () => {
      await page.getByRole('dialog').getByRole('navigation').getByRole('button', { name: 'Relays', exact: true }).click();
      await shot(page, 'beacon-settings-relays');
      await page.getByRole('dialog').getByRole('button', { name: /^General/ }).click();
      await shot(page, 'beacon-settings-comm-link');
      await page.getByRole('dialog').getByRole('button', { name: /^All relays/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^general/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'permissions' }).click();
      await shot(page, 'beacon-settings-relay-permissions');
    });
    await esc(page);
  });

  // ---- User settings ------------------------------------------------------------------
  await step('user settings', async () => {
    await page.getByRole('button', { name: 'User Settings' }).click();
    await shot(page, 'settings-account');
    for (const tab of ['Profiles', 'Status', 'Data & Privacy', 'Notifications', 'Devices', 'Voice & Video', 'Chat', 'Appearance', 'Keybinds']) {
      await step(`settings ${tab}`, async () => {
        await page.getByRole('dialog').getByRole('button', { name: tab, exact: true }).click();
        await shot(page, `settings-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`);
      });
    }
    await page.getByRole('dialog').getByRole('button', { name: 'My Account', exact: true }).click().catch(async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'Account', exact: true }).click();
    });
    const settings = page.getByRole('dialog').first();
    const subDialog = async (name: string, open: () => Promise<void>) =>
      step(`dialog ${name}`, async () => {
        await open();
        await expect(page.getByRole('dialog')).toHaveCount(2);
        await page.waitForTimeout(400);
        await shot(page, `settings-dialog-${name}`);
        await esc(page);
        await expect(page.getByRole('dialog')).toHaveCount(1);
      });
    // Account Info rows: Display Name, Username, Email, then Password.
    await subDialog('username', () => settings.getByRole('button', { name: 'Edit', exact: true }).nth(1).click());
    await subDialog('email', () => settings.getByRole('button', { name: 'Edit', exact: true }).nth(2).click());
    await subDialog('password', () => settings.getByRole('button', { name: 'Edit', exact: true }).nth(3).click());
    await subDialog('mfa', () => settings.getByRole('button', { name: /^Multi-Factor Authentication/ }).click());
    await subDialog('passkeys', () => settings.getByRole('button', { name: /^Passkeys/ }).click());
    await subDialog('disable', () => settings.getByRole('button', { name: 'Disable Account' }).click());
    await subDialog('delete', () => settings.getByRole('button', { name: 'Delete Account' }).click());
    await esc(page);
  });

  // ---- Vault, drives, report, console -------------------------------------------------
  // ---- Account card, status, badges, emoji picker ------------------------------------------
  await step('account card', async () => {
    await page.goto(`${base}/${w.generalId}`);
    await page.getByRole('button', { name: 'Open your profile' }).click();
    await shot(page, 'account-card');
    await page.getByRole('dialog', { name: 'Your profile' }).getByRole('button', { name: /custom status/ }).click();
    await shot(page, 'status-dialog');
    await page.getByRole('dialog', { name: 'Set your status' }).getByRole('button', { name: /status emoji/i }).click();
    await shot(page, 'status-emoji-picker');
    await esc(page);
    await esc(page);
    await page.getByRole('button', { name: 'Open your profile' }).click();
    await page.getByRole('dialog', { name: 'Your profile' }).getByRole('button', { name: 'Badges' }).click();
    await shot(page, 'badges-dialog');
    await esc(page);
  });
  await step('composer emoji picker', async () => {
    await page.getByRole('button', { name: 'Select emoji' }).click();
    await shot(page, 'emoji-picker-composer');
    await esc(page);
  });

  // ---- Events, Channels & Roles, Members ----------------------------------------------------
  await step('events', async () => {
    const nav = page.getByRole('navigation', { name: 'Relays' });
    await nav.getByRole('button', { name: /Event/ }).click();
    await shot(page, 'events-empty');
    await page.getByRole('dialog').getByRole('button', { name: 'Create Event' }).first().click();
    await shot(page, 'events-create-location');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Event Topic').fill('Veil Nebula survey');
    await page.getByLabel('Description').fill('Charting the eastern filaments. Bring your star charts.');
    await shot(page, 'events-create-details');
    await page.getByRole('button', { name: 'Next' }).click();
    await shot(page, 'events-create-preview');
    await page.getByRole('button', { name: 'Create Event' }).click();
    await page.waitForTimeout(600);
    await shot(page, 'events-list');
    await esc(page);
  });
  await step('channels and roles', async () => {
    await call(w.nova, 'PUT', `/beacons/${w.beaconId}/onboarding-questions`, {
      questions: [
        {
          title: 'Which crews do you fly with?',
          multiple: true,
          options: [
            { label: 'Navigation', emoji: '🧭', description: 'Charts, routes and jump plans' },
            { label: 'Science', emoji: '🔬', description: 'Samples from every moon' },
            { label: 'Engineering', emoji: '🔧', description: 'Keep the reactor happy' },
            { label: 'Comms', emoji: '📡', description: 'Night-shift signals' },
          ],
        },
      ],
    });
    await page.getByRole('navigation', { name: 'Relays' }).getByRole('button', { name: 'Channels & Roles' }).click();
    await page.getByRole('checkbox', { name: /Navigation/ }).click();
    await page.waitForTimeout(400);
    await shot(page, 'channels-roles-customize');
    await page.getByRole('button', { name: /^Browse Channels/ }).click();
    await shot(page, 'channels-roles-browse');
  });
  await step('members page', async () => {
    await page.getByRole('navigation', { name: 'Relays' }).getByRole('button', { name: 'Members' }).click();
    await page.waitForTimeout(600);
    await shot(page, 'members-page');
    await page.getByRole('button', { name: 'Prune' }).click();
    await shot(page, 'members-prune');
    await esc(page);
  });
  await step('beacon relays settings', async () => {
    await page.locator('aside button').filter({ hasText: 'Andromeda Station' }).first().click();
    await page.getByRole('menuitem', { name: /Beacon Settings/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Onboarding', exact: true }).click();
    await shot(page, 'beacon-settings-onboarding-questions');
    await esc(page);
  });

  await step('vault', async () => {
    await page.goto('/channels/@me');
    await page.getByRole('complementary').getByRole('button', { name: 'Subspace Vault' }).click();
    await page.waitForTimeout(800);
    await shot(page, 'vault-files');
    await page.getByRole('tab', { name: 'Cloud Drives' }).click();
    await shot(page, 'vault-cloud-drives');
    const card = page.getByRole('list', { name: 'Cloud drives' }).getByRole('listitem').filter({ hasText: 'Google Drive' });
    const popup = page.waitForEvent('popup');
    await card.getByRole('button', { name: 'Connect' }).click();
    await (await popup).waitForEvent('close');
    await card.getByRole('button', { name: 'Browse' }).click();
    await page.waitForTimeout(800);
    await shot(page, 'vault-drive-browser');
    await esc(page);
  });
  await step('report', async () => {
    await page.goto(`${base}/${w.generalId}`);
    await page.getByRole('log').getByRole('article').filter({ hasText: 'Sample notes' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Report Transmission' }).click();
    const report = page.getByRole('dialog', { name: 'Report Transmission' });
    await report.getByRole('radio').first().click();
    await shot(page, 'modal-report');
    await report.getByLabel('Details').fill('Testing the report flow for the screenshots.');
    await report.getByRole('button', { name: 'Submit Report' }).click();
    await shot(page, 'modal-report-thanks');
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await step('console', async () => {
    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Command Console' }).click();
    await page.waitForTimeout(800);
    await shot(page, 'console-reports');
    for (const tab of ['Transmitters', 'Storage']) {
      await step(`console ${tab}`, async () => {
        await page.getByRole('button', { name: tab, exact: true }).click();
        await page.waitForTimeout(600);
        await shot(page, `console-${tab.toLowerCase()}`);
      });
    }
    await esc(page);
  });

  // ---- Joining a beacon ----------------------------------------------------------------
  await step('invite and onboarding', async () => {
    const newcomer = await register('newcomer', 'New Cadet');
    const p = await openAs(browser, newcomer, `/invite/${w.inviteCode}`);
    await p.waitForTimeout(1000);
    await shot(p, 'invite-signed-in');
    await p.getByRole('button', { name: /Accept|Join/ }).first().click();
    await p.waitForTimeout(1500);
    await shot(p, 'onboarding-rules');
    await p.context().close();
  });
  await step('fresh account', async () => {
    const fresh = await register('fresh', 'Fresh Pilot', { verified: false });
    const p = await openAs(browser, fresh, '/channels/@me');
    await p.waitForTimeout(800);
    await shot(p, 'home-new-account');
    await p.context().close();
  });

  // ---- Phone width (what the mobile app shows) -----------------------------------------
  await step('phone', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    // The rail is in the closed drawer at this width, so wait for the shell without it.
    await signIn(p, w.nova, `${base}/${w.generalId}`, { shell: false });
    const phone = (name: string) => shot(p, `phone-${name}`);
    await step('phone relay', async () => {
      await expect(p.getByRole('log')).toContainText('Route plotted', { timeout: 20_000 });
      await phone('text-relay');
    });
    await step('phone drawer', async () => {
      await p.getByRole('button', { name: 'Open navigation' }).click();
      await phone('navigation-drawer');
      await p.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /general/ }).click();
    });
    await step('phone members', async () => {
      await p.getByRole('button', { name: /Member List/ }).click();
      await phone('members');
      await p.mouse.click(20, 400);
    });
    await step('phone friends', async () => {
      await p.goto('/channels/@me');
      await p.waitForTimeout(800);
      await phone('friends');
    });
    await step('phone dm', async () => {
      await p.goto(`/channels/@me/${w.dmIonId}`);
      await expect(p.getByRole('log')).toContainText('Took me all night');
      await phone('dm');
    });
    await step('phone forum', async () => {
      await p.goto(`${base}/${w.forumId}`);
      await p.waitForTimeout(1000);
      await phone('forum');
    });
    await step('phone gallery', async () => {
      await p.goto(`${base}/${w.galleryId}`);
      await p.waitForTimeout(1000);
      await phone('gallery');
    });
    await step('phone settings', async () => {
      await p.goto(`${base}/${w.generalId}`);
      await p.getByRole('button', { name: 'Open navigation' }).click();
      await p.getByRole('button', { name: 'User Settings' }).click();
      await phone('settings-list');
      await p.getByRole('dialog').getByRole('button', { name: 'Profiles', exact: true }).click();
      await phone('settings-page');
    });
    await ctx.close();
  });

  await keplerPage.context().close();
  await ionPage.context().close();
  console.log(`Captured ${n} screens into ${OUT}`);
  if (failures.length) console.log(`Skipped:\n- ${failures.join('\n- ')}`);
});

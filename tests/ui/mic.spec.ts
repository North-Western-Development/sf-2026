import { test, expect, register, signIn } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';

test.use({
  launchOptions: { args: MEDIA_ARGS },
  permissions: ['microphone'],
});

test('the mic test shows the fake microphone’s level, and manual sensitivity has a slider', async ({ page }) => {
  const me = await register('mictest', 'Mic Pilot');
  await signIn(page, me);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Voice & Video', exact: true }).click();
  await page.getByRole('button', { name: "Let's Check" }).click();
  const meter = page.getByRole('meter', { name: 'Input level' });
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 10_000 }).toBeGreaterThan(-90);
  await page.getByRole('button', { name: 'Stop Testing' }).click();
  await page.getByRole('switch', { name: 'Automatically determine input sensitivity' }).click();
  await expect(page.getByRole('slider', { name: 'Input sensitivity' })).toBeVisible();
});

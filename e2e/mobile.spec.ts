import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mobile: no horizontal page scroll and tap-to-schedule works', async ({ page }) => {
  await signIn(page);
  // own data, so this test doesn't depend on what the desktop specs left behind
  const headers = { 'x-requested-with': 'aeonic-web' };
  const project = await (await page.request.post('/api/v1/projects', { headers, data: { name: 'Mobile project' } })).json();
  await page.request.post('/api/v1/tasks', { headers, data: { projectId: project.id, title: 'Tap me' } });
  await page.goto(`/?projects=${project.id}`); // just this project's card, as a user would filter

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Schedule Tap me' }).click();
  await page.getByRole('button', { name: /^Today/ }).click();
  await page.getByRole('button', { name: 'Do the whole subtask' }).click();
  await expect(page.locator('section[data-date]').first().getByText('Tap me')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.screenshot({ path: 'e2e/.tmp/board-mobile.png' });
});

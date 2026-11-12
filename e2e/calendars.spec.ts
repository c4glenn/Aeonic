import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('subscribe to an ICS link: events appear in week, month, gantt and list; hide, error handling, remove', async ({ page }) => {
  await signIn(page);

  // --- add via Settings; bad links are rejected with a readable error
  await page.goto('/#/settings');
  await page.getByLabel('Name', { exact: true }).first().fill('E2E Cal');
  await page.getByLabel('ICS link').fill('http://localhost:3102/notcal');
  await page.locator('form', { has: page.getByLabel('ICS link') }).getByRole('button', { name: /Add|Checking/ }).click();
  await expect(page.getByText(/Not an ICS calendar/)).toBeVisible();

  await page.getByLabel('ICS link').fill('http://localhost:3102/cal.ics');
  await page.locator('form', { has: page.getByLabel('ICS link') }).getByRole('button', { name: /Add|Checking/ }).click();
  const item = page.locator('li', { hasText: 'E2E Cal' });
  await expect(item).toBeVisible();
  await expect(item.getByText(/localhost:3102/)).toBeVisible(); // host only; the full link is never shown

  // --- week: all-day tag in the day card, timed event in the hour grid
  await page.goto('/#/');
  await expect(page.locator('section[data-date] >> text=Cal offsite')).toBeVisible();
  const timed = page.locator('[data-timecol] [data-event]').filter({ hasText: 'Cal standup' });
  await expect(timed).toBeVisible();
  const col = (await page.locator('[data-timecol]').first().boundingBox())!;
  const blk = (await timed.boundingBox())!;
  expect(Math.abs(blk.y - col.y - 10 * 48)).toBeLessThan(3); // 10:00 → 480px
  expect(Math.abs(blk.height - 48)).toBeLessThan(3); // one hour

  // --- month, gantt, list
  await page.goto('/#/month');
  await expect(page.getByText('Cal offsite').first()).toBeVisible();
  await expect(page.getByText('Cal daily').first()).toBeVisible();
  await page.goto('/#/gantt');
  await expect(page.locator('[data-event]').filter({ hasText: 'Cal daily' }).first()).toBeVisible();
  await expect(page.getByText('E2E Cal').first()).toBeVisible();
  await page.goto('/#/list');
  await expect(page.getByRole('region', { name: 'Upcoming calendar events' }).getByText('Cal standup')).toBeVisible();

  // --- hide / show
  await page.goto('/#/settings');
  await page.getByLabel('Show E2E Cal').click();
  await page.goto('/#/list');
  await expect(page.getByRole('region', { name: 'Upcoming calendar events' })).toHaveCount(0);
  await page.goto('/#/settings');
  await page.getByLabel('Show E2E Cal').click();

  // --- remove (also keeps the other specs free of calendar noise)
  await page.getByRole('button', { name: 'Remove E2E Cal' }).click();
  await expect(page.locator('li', { hasText: 'E2E Cal' })).toHaveCount(0);
  await page.goto('/#/');
  await expect(page.getByText('Cal offsite')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { dragTo, signIn } from './helpers';

test('week strip shows 7 days with weekends styled differently', async ({ page }) => {
  await signIn(page);
  const days = page.locator('section[data-date]');
  await expect(days).toHaveCount(7);
  const weekendCount = await page.locator('section[data-date].weekend-surface').count();
  expect(weekendCount).toBeGreaterThanOrEqual(1);
  expect(weekendCount).toBeLessThanOrEqual(2);
  await page.screenshot({ path: 'e2e/.tmp/board-desktop.png', fullPage: true });
});

test('drag → whole subtask schedules it and unlocks its dependent', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('Locked (2)')).toBeVisible();
  const day = page.locator('section[data-date]').nth(1);

  await dragTo(page, 'Drag Sketch layout', day);
  await expect(page.getByRole('heading', { name: 'What are you planning on doing?' })).toBeVisible();
  await page.getByRole('button', { name: 'Do the whole subtask' }).click();

  await expect(day.getByText('Sketch layout')).toBeVisible();
  // dependent "Buy materials" is now available (draggable handle appears); only "Build frame" remains locked
  await expect(page.getByRole('button', { name: 'Drag Buy materials' })).toBeVisible();
  await expect(page.getByText('Locked (1)')).toBeVisible();
});

test('drag → stated goal creates a scheduled child subtask', async ({ page }) => {
  await signIn(page);
  const day = page.locator('section[data-date]').nth(2);
  await dragTo(page, 'Drag Measure the lot', day);
  await page.getByLabel('What are you planning on doing', { exact: true }).fill('Walk the perimeter');
  await page.getByRole('button', { name: 'Add this as a step' }).click();
  await expect(day.getByText('Walk the perimeter')).toBeVisible();
  // the parent stays available to schedule
  await expect(page.getByRole('button', { name: 'Drag Measure the lot' })).toBeVisible();
});

test('hard and soft due markers use distinct styles on their day', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText(/^Target /).first()).toBeVisible();
  await expect(page.getByText(/^Due /).first()).toBeVisible();
  await expect(page.locator('.due-hard').first()).toBeVisible();
  await expect(page.locator('.due-soft').first()).toBeVisible();
});

test('filter by tag and sort by importance persist in the URL', async ({ page }) => {
  await signIn(page);
  await page.getByRole('radio', { name: 'Importance' }).click();
  await expect(page).toHaveURL(/sort=importance/);
  await page.getByRole('button', { name: /Filter/ }).click();
  await page.getByRole('button', { name: 'All tags' }).click();
  await page.getByRole('option', { name: /design/ }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/tags=design/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Drag Measure the lot' })).toBeVisible();
});

test('add a project and a subtask', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByLabel('Name').fill('Write the report');
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('heading', { name: 'Write the report' })).toBeVisible();
  await page.getByRole('button', { name: 'Add subtask to Write the report' }).click();
  await page.getByLabel('Title').fill('Outline');
  await page.getByRole('button', { name: 'Add subtask' }).click();
  await expect(page.getByRole('button', { name: 'Drag Outline' })).toBeVisible();
});

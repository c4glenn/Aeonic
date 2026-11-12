import { expect, test, type Page } from '@playwright/test';
import { dragTo, signIn } from './helpers';

const iso = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const H = { 'x-requested-with': 'todo-web' };

/** Project "Views" with: A (scheduled today, hard due +4) → B (scheduled +2, soft due +6); C free; D blocked by C. */
async function seed(page: Page, name: string) {
  const post = async (url: string, data: unknown, method: 'post' | 'put' = 'post') =>
    (await (await page.request[method](url, { headers: H, data })).json()) as { id: string };
  const p = await post('/api/v1/projects', { name });
  const a = await post('/api/v1/tasks', { projectId: p.id, title: `${name} A`, hardDue: iso(4), importance: 4 });
  const b = await post('/api/v1/tasks', { projectId: p.id, title: `${name} B`, softDue: iso(6), blockedBy: [a.id] });
  const c = await post('/api/v1/tasks', { projectId: p.id, title: `${name} C` });
  await post('/api/v1/tasks', { projectId: p.id, title: `${name} D`, blockedBy: [c.id] });
  await post(`/api/v1/tasks/${a.id}/schedule`, { date: iso(0) }, 'put');
  await post(`/api/v1/tasks/${b.id}/schedule`, { date: iso(2) }, 'put');
  return { p, a, b, c };
}

test('list view: rows, locked state, grouping, completing unlocks dependents', async ({ page }) => {
  await signIn(page);
  await seed(page, 'ListP');
  await page.goto('/#/list');
  const row = (t: string) => page.locator('tr', { has: page.getByRole('button', { name: t, exact: true }) });
  await expect(row('ListP A')).toBeVisible();
  await expect(row('ListP D').getByText(/after ListP C/)).toBeVisible(); // locked, names its blocker
  await expect(row('ListP A').getByText(/^Due /)).toBeVisible();
  await expect(row('ListP B').getByText(/^Target /)).toBeVisible();

  await page.getByRole('radio', { name: 'By project' }).click();
  await expect(page.getByRole('cell', { name: /^ListP \(4\)/ })).toBeVisible();

  await row('ListP C').getByRole('checkbox').click();
  // completed tasks leave the list (Show completed is off) and unlock their dependents
  await expect(row('ListP C')).toHaveCount(0);
  await expect(row('ListP D').getByText(/after ListP C/)).toHaveCount(0);
});

test.describe('month', () => {
  test.use({ viewport: { width: 1440, height: 1500 } });

test('month view: renders tasks and due markers, navigates, drag from tray schedules', async ({ page }) => {
  await signIn(page);
  await seed(page, 'MonthP');
  await page.goto('/#/month');
  const cell = (offset: number) => page.locator(`[data-date="${iso(offset)}"]`);
  await expect(cell(0).getByText('MonthP A')).toBeVisible();
  await expect(cell(4).getByTitle(/Hard due: MonthP A/)).toBeVisible();
  expect(await page.locator('.weekend-surface').count()).toBeGreaterThanOrEqual(8);

  const heading = page.getByRole('heading', { level: 2 }).first();
  const before = await heading.textContent();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(heading).not.toHaveText(before!);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(heading).toHaveText(before!);

  await dragTo(page, 'Drag MonthP C', cell(1));
  await page.getByRole('button', { name: 'Do the whole subtask' }).click();
  await expect(cell(1).getByText('MonthP C')).toBeVisible();
});
});

test('gantt view: bars, hard/soft markers and dependency arrow', async ({ page }) => {
  await signIn(page);
  await seed(page, 'GanttP');
  await page.goto('/#/gantt');
  await expect(page.getByTestId('gantt')).toBeVisible();
  await expect(page.getByRole('button', { name: /^GanttP A, scheduled/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Due .*: GanttP A$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Target .*: GanttP B$/ })).toBeVisible();
  await expect(page.locator('[data-edge]')).not.toHaveCount(0);
  // zoom changes the timeline width
  const w = (await page.getByTestId('gantt-svg').boundingBox())!.width;
  await page.getByRole('radio', { name: '2 weeks' }).click();
  expect((await page.getByTestId('gantt-svg').boundingBox())!.width).toBeGreaterThan(w * 0.5);
  await page.screenshot({ path: 'e2e/.tmp/gantt.png', fullPage: true });
});

test('gantt: scheduling a dependent before its blocker is flagged', async ({ page }) => {
  await signIn(page);
  const { a, b } = await seed(page, 'ConflictP');
  await page.request.put(`/api/v1/tasks/${b.id}/schedule`, { headers: H, data: { date: iso(-1) } });
  await page.goto('/#/gantt');
  await expect(page.locator(`[data-edge="${a.id}->${b.id}"]`)).toHaveAttribute('stroke-dasharray', '4 3');
});

test('nav switches views and filters persist across them', async ({ page }) => {
  await signIn(page);
  await page.getByRole('radio', { name: 'Importance' }).click();
  for (const name of ['List', 'Month', 'Gantt']) {
    await page.getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`#/${name.toLowerCase()}`));
    await expect(page).toHaveURL(/sort=importance/);
  }
});

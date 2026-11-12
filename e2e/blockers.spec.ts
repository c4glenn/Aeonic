import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const H = { 'x-requested-with': 'aeonic-web' };
const iso = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function setup(page: Page, tag: string) {
  const post = async (url: string, data: unknown) => (await (await page.request.post(url, { headers: H, data })).json()) as { id: string };
  const p1 = await post('/api/v1/projects', { name: `${tag} One` });
  const p2 = await post('/api/v1/projects', { name: `${tag} Two` });
  const a = await post('/api/v1/tasks', { projectId: p1.id, title: `${tag}A` });
  const b = await post('/api/v1/tasks', { projectId: p2.id, title: `${tag}B` }); // a different project
  const c = await post('/api/v1/tasks', { projectId: p1.id, title: `${tag}C` });
  return { p1, p2, a, b, c };
}
const getTask = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/v1/tasks/${id}`)).json()) as { blockedBy: string[]; unblocked: boolean; scheduledDate: string | null };
const schedule = (page: Page, id: string, date: string) => page.request.put(`/api/v1/tasks/${id}/schedule`, { headers: H, data: { date } });
const row = (page: Page, title: string) => page.locator('tr[data-task]', { has: page.getByRole('button', { name: title, exact: true }) });

async function addBlocker(page: Page, search: string) {
  await page.getByTestId('blocker-picker').getByRole('button', { name: /Add (a|another) blocker/ }).click();
  await page.getByPlaceholder('Search tasks in any project…').fill(search);
  await page.getByRole('option', { name: new RegExp(search) }).click();
}

test('several blockers from different projects: pick, see progress, unlock only when all are ready', async ({ page }) => {
  await signIn(page);
  const { p1, p2, a, b, c } = await setup(page, 'Blk');
  await page.goto(`/?projects=${p1.id},${p2.id}#/list`);

  // --- pick two blockers (one from another project) in the edit dialog
  await row(page, 'BlkC').getByRole('button', { name: 'BlkC', exact: true }).click();
  await addBlocker(page, 'BlkA');
  await addBlocker(page, 'BlkB');
  const picker = page.getByTestId('blocker-picker');
  await expect(picker.locator('[data-blocker]')).toHaveCount(2);
  await expect(picker.locator(`[data-blocker="${b.id}"]`)).toContainText('Blk Two'); // names the other project
  await expect(picker.getByTestId('blocker-summary')).toHaveText('Locked — 2 of 2 blockers are not scheduled yet.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await getTask(page, c.id)).blockedBy.length).toBe(2);

  // --- the list names every outstanding blocker
  await expect(row(page, 'BlkC').getByText('Waiting on BlkA, BlkB')).toBeVisible();

  // --- one ready → still locked, and the remaining blocker is named with progress
  await schedule(page, a.id, iso(1));
  await expect(row(page, 'BlkC').getByText('Waiting on BlkB (1 of 2 ready)')).toBeVisible();
  expect((await getTask(page, c.id)).unblocked).toBe(false);
  expect((await schedule(page, c.id, iso(2))).status()).toBe(409); // the API refuses too

  // --- all ready → unlocked
  await schedule(page, b.id, iso(1));
  await expect(row(page, 'BlkC').getByText(/Waiting on/)).toHaveCount(0);
  expect((await getTask(page, c.id)).unblocked).toBe(true);

  // --- un-scheduling one re-locks it
  await page.request.delete(`/api/v1/tasks/${a.id}/schedule`, { headers: H });
  await expect(row(page, 'BlkC').getByText('Waiting on BlkA (1 of 2 ready)')).toBeVisible();
});

test('remove one blocker from the dialog; every blocker is also named on the project card', async ({ page }) => {
  await signIn(page);
  const { p1, p2, a, b, c } = await setup(page, 'Rm');
  await page.request.put(`/api/v1/tasks/${c.id}/dependencies`, { headers: H, data: { blockedBy: [a.id, b.id] } });
  await page.goto(`/?projects=${p1.id},${p2.id}`);

  // the card's Locked group (collapsed by default) lists all names
  const card = page.locator('article', { has: page.getByRole('heading', { name: 'Rm One' }) });
  await card.getByText(/^Locked \(/).click();
  await expect(card.getByText('Waiting on RmA, RmB')).toBeVisible();

  await card.getByRole('button', { name: /RmC/ }).click();
  const picker = page.getByTestId('blocker-picker');
  await expect(picker.locator('[data-blocker]')).toHaveCount(2);
  await picker.getByRole('button', { name: 'Remove blocker RmA' }).click();
  await expect(picker.locator('[data-blocker]')).toHaveCount(1);
  await expect(picker.getByTestId('blocker-summary')).toHaveText('Locked — 1 of 1 blocker is not scheduled yet.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await getTask(page, c.id)).blockedBy).toEqual([b.id]);

  // remove the last one → no blockers, available now
  await card.getByRole('button', { name: /RmC/ }).click();
  await page.getByTestId('blocker-picker').getByRole('button', { name: 'Remove blocker RmB' }).click();
  await expect(page.getByTestId('blocker-picker').getByText(/Add a blocker… \(none/)).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await getTask(page, c.id)).unblocked).toBe(true);
});

test('the picker never offers a task that would create a cycle', async ({ page }) => {
  await signIn(page);
  const { p1, p2, a, b, c } = await setup(page, 'Cy');
  await page.request.put(`/api/v1/tasks/${c.id}/dependencies`, { headers: H, data: { blockedBy: [a.id, b.id] } });
  await page.goto(`/?projects=${p1.id},${p2.id}#/list`);

  await row(page, 'CyA').getByRole('button', { name: 'CyA', exact: true }).click();
  await page.getByTestId('blocker-picker').getByRole('button', { name: /Add a blocker/ }).click();
  await page.getByPlaceholder('Search tasks in any project…').fill('CyC'); // C depends on A, so A can't depend on C
  await expect(page.getByText('No tasks to add')).toBeVisible();
  await page.getByPlaceholder('Search tasks in any project…').fill('CyB'); // B is unrelated to A → allowed
  await expect(page.getByRole('option', { name: /CyB/ })).toBeVisible();
});

test('create a subtask with several blockers; changing its project keeps them', async ({ page }) => {
  await signIn(page);
  const { p1, p2, a, b } = await setup(page, 'Nw');
  await page.goto(`/?projects=${p1.id},${p2.id}`);

  await page.getByRole('button', { name: 'Subtask', exact: true }).click();
  await page.getByLabel('Title').fill('NwNew');
  await addBlocker(page, 'NwA');
  await addBlocker(page, 'NwB');
  // switching project used to wipe the blockers
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Nw Two' }).click();
  await expect(page.getByTestId('blocker-picker').locator('[data-blocker]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add subtask', exact: true }).click();

  await expect
    .poll(async () => {
      const items = (await (await page.request.get('/api/v1/tasks?limit=500')).json()).items as { title: string; blockedBy: string[]; projectId: string }[];
      const t = items.find((x) => x.title === 'NwNew');
      return t ? { n: t.blockedBy.length, inTwo: t.projectId === p2.id, has: [a.id, b.id].every((id) => t.blockedBy.includes(id)) } : null;
    })
    .toEqual({ n: 2, inTwo: true, has: true });
});

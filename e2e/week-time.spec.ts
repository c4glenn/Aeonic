import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const H = { 'x-requested-with': 'todo-web' };
const PX_PER_MIN = 0.8;

const iso = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function newTask(page: Page, title: string) {
  const p = await (await page.request.post('/api/v1/projects', { headers: H, data: { name: `P ${title}` } })).json();
  const t = await (await page.request.post('/api/v1/tasks', { headers: H, data: { projectId: p.id, title } })).json();
  projectOf.set(t.id, p.id);
  return t.id as string;
}
const projectOf = new Map<string, string>();
const getTask = async (page: Page, id: string) => (await (await page.request.get(`/api/v1/tasks/${id}`)).json()) as { scheduledDate: string | null; startTime: string | null; durationMinutes: number | null };

type Pt = { x: number; y: number };
/**
 * Drag in two phases: first into the middle of the hour grid (it may auto-scroll as the pointer enters),
 * then — once it has settled — aim at the real target, which is computed lazily from the live layout.
 */
async function mouseDrag(page: Page, from: Pt, to: Pt | (() => Promise<Pt>), hold?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 });
  const grid = (await page.getByTestId('time-grid').boundingBox())!;
  await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height / 2, { steps: 12 });
  await page.waitForTimeout(250);
  const target = typeof to === 'function' ? await to() : to;
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await hold?.();
  await page.mouse.up();
}
/** Straight drag with no detours — for the resize handle, which uses plain pointer events. */
async function plainDrag(page: Page, from: Pt, to: Pt) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}
const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
/** Viewport y of a wall-clock minute in a day's column (the grid is scrolled, but boundingBox is viewport-relative). */
async function slot(page: Page, dayIndex: number, minutes: number) {
  const b = (await page.locator('[data-timecol]').nth(dayIndex).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + minutes * PX_PER_MIN + 1 };
}

test('week view has an hour grid with 7 day columns, hour labels and a today marker', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-timecol]')).toHaveCount(7);
  await expect(page.getByTestId('time-grid').getByText(/^(10 AM|10:00)/).first()).toBeAttached();
  const col = (await page.locator('[data-timecol]').first().boundingBox())!;
  expect(Math.round(col.height)).toBe(24 * 48);
});

test('drag onto the grid → 30 min block at the snapped slot; drop ghost previews it', async ({ page }) => {
  await signIn(page);
  const id = await newTask(page, 'GridA');
  await page.goto(`/?projects=${projectOf.get(id)}`); // only this project's card, so its chip is near the grid
  const handle = (await page.getByRole('button', { name: 'Drag GridA' }).boundingBox())!;
  const target = () => slot(page, 1, 10 * 60 + 5); // 10:05 → snaps to 10:00

  await mouseDrag(page, center(handle), target, async () => {
    await expect(page.locator('[data-ghost]')).toBeVisible();
    const g = (await page.locator('[data-ghost]').boundingBox())!;
    const c = (await page.locator('[data-timecol]').nth(1).boundingBox())!;
    expect(Math.abs(g.y - c.y - 600 * PX_PER_MIN)).toBeLessThan(2);
    expect(Math.abs(g.height - 30 * PX_PER_MIN)).toBeLessThan(2);
  });

  await expect(page.getByRole('heading', { name: 'What are you planning on doing?' })).toBeVisible();
  await expect(page.getByLabel('Start time')).toHaveValue('10:00');
  await page.getByRole('button', { name: 'Do the whole subtask' }).click();

  const block = page.locator(`[data-block="${id}"]`);
  await expect(block).toBeVisible();
  await expect.poll(async () => (await getTask(page, id)).startTime).toBe('10:00');
  expect(await getTask(page, id)).toMatchObject({ scheduledDate: iso(1), durationMinutes: 30 });
  const b = (await block.boundingBox())!;
  expect(Math.abs(b.height - 30 * PX_PER_MIN)).toBeLessThan(3);
});

test('drag the bottom handle to lengthen and shorten (snaps to 15 min, min 15, stays in day)', async ({ page }) => {
  await signIn(page);
  const id = await newTask(page, 'GridB');
  await page.request.put(`/api/v1/tasks/${id}/schedule`, { headers: H, data: { date: iso(2), startTime: '09:00' } });
  await page.reload();

  const handle = () => page.getByRole('button', { name: /^Resize GridB/ });
  let h = center((await handle().boundingBox())!);
  await plainDrag(page, h, { x: h.x, y: h.y + 60 * PX_PER_MIN * 1.0 }); // +60 min
  await expect.poll(async () => (await getTask(page, id)).durationMinutes).toBe(90);

  h = center((await handle().boundingBox())!);
  await plainDrag(page, h, { x: h.x, y: h.y - 30 * PX_PER_MIN }); // -30 min
  await expect.poll(async () => (await getTask(page, id)).durationMinutes).toBe(60);

  h = center((await handle().boundingBox())!);
  await plainDrag(page, h, { x: h.x, y: Math.max(h.y - 250, 2) }); // far up → clamps to 15
  await expect.poll(async () => (await getTask(page, id)).durationMinutes).toBe(15);

  // keyboard: arrows nudge by 15 minutes
  await handle().focus();
  await page.keyboard.press('ArrowDown');
  await expect(handle()).toHaveAttribute('aria-label', /30 minutes/);
  await expect.poll(async () => (await getTask(page, id)).durationMinutes).toBe(30);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await getTask(page, id)).durationMinutes).toBe(15);

  // held-down key: rapid repeats accumulate instead of overwriting each other
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await getTask(page, id)).durationMinutes).toBe(60);
});

test('move a block to another day/time keeps its length; dropping on the day card makes it untimed', async ({ page }) => {
  await signIn(page);
  const id = await newTask(page, 'GridC');
  await page.request.put(`/api/v1/tasks/${id}/schedule`, { headers: H, data: { date: iso(1), startTime: '09:00', durationMinutes: 90 } });
  await page.reload();

  const block = page.locator(`[data-block="${id}"]`);
  const b = (await block.boundingBox())!;
  const grab = { x: b.x + b.width / 2, y: b.y + 20 }; // grab 20px below the block's top
  await mouseDrag(page, grab, () => slot(page, 3, 12 * 60 + 20)); // pointer at 12:20 (mid-grid, so no edge auto-scroll), grabbed 25 min below the top → 11:55 → snaps 12:00
  await expect.poll(async () => (await getTask(page, id)).scheduledDate).toBe(iso(3));
  expect(await getTask(page, id)).toMatchObject({ startTime: '12:00', durationMinutes: 90 });

  // back to an untimed day card
  const b2 = (await page.locator(`[data-block="${id}"]`).boundingBox())!;
  const card = (await page.locator(`section[data-date="${iso(4)}"]`).boundingBox())!;
  await mouseDrag(page, { x: b2.x + b2.width / 2, y: b2.y + 6 }, { x: card.x + card.width / 2, y: card.y + card.height / 2 });
  await expect.poll(async () => (await getTask(page, id)).startTime).toBeNull();
  expect(await getTask(page, id)).toMatchObject({ scheduledDate: iso(4), durationMinutes: null });
  await expect(page.locator(`section[data-date="${iso(4)}"]`).getByText('GridC', { exact: true })).toBeVisible();
});

test('overlapping blocks sit side by side', async ({ page }) => {
  await signIn(page);
  const a = await newTask(page, 'OverlapA');
  const b = await newTask(page, 'OverlapB');
  for (const [id, start] of [[a, '11:00'], [b, '11:15']] as const) {
    await page.request.put(`/api/v1/tasks/${id}/schedule`, { headers: H, data: { date: iso(5), startTime: start, durationMinutes: 60 } });
  }
  await page.reload();
  const col = (await page.locator(`[data-timecol="${iso(5)}"]`).boundingBox())!;
  const ba = (await page.locator(`[data-block="${a}"]`).boundingBox())!;
  const bb = (await page.locator(`[data-block="${b}"]`).boundingBox())!;
  expect(ba.width).toBeLessThan(col.width * 0.6);
  expect(bb.width).toBeLessThan(col.width * 0.6);
  expect(Math.abs(ba.x - bb.x)).toBeGreaterThan(col.width * 0.3);
});

test('edit dialog can set a start time and length; list shows the time', async ({ page }) => {
  await signIn(page);
  const id = await newTask(page, 'EditTime');
  await page.request.put(`/api/v1/tasks/${id}/schedule`, { headers: H, data: { date: iso(1) } });
  await page.goto('/#/list');
  await page.getByRole('button', { name: 'EditTime', exact: true }).click();
  await page.getByLabel('Start time').fill('13:30');
  await page.getByRole('combobox', { name: 'Length' }).click();
  await page.getByRole('option', { name: '2 h' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await getTask(page, id)).startTime).toBe('13:30');
  expect(await getTask(page, id)).toMatchObject({ durationMinutes: 120 });
  await expect(page.locator('tr', { hasText: 'EditTime' }).getByText(/1:30/)).toBeVisible();
});

test('regression: an open edit dialog keeps in-progress edits when live data refreshes', async ({ page }) => {
  await signIn(page);
  const id = await newTask(page, 'KeepMe');
  await page.goto('/#/list');
  await page.getByRole('button', { name: 'KeepMe', exact: true }).click();
  const title = page.getByLabel('Title');
  await title.fill('KeepMe — half-typed edit');
  // another device changes data → SSE → refetch while the dialog is open
  await page.request.post('/api/v1/tasks', { headers: H, data: { projectId: (await (await page.request.get(`/api/v1/tasks/${id}`)).json()).projectId, title: 'Noise' } });
  // (the dialog is modal, so the page behind it is aria-hidden: query the DOM, not roles)
  await expect(page.locator('tr[data-task]', { hasText: 'Noise' })).toBeAttached({ timeout: 10_000 });
  await expect(title).toHaveValue('KeepMe — half-typed edit');
});

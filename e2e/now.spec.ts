import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const H = { 'x-requested-with': 'aeonic-web' };
const iso = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

test('banner: current calendar event → upcoming task → current task, live as data changes', async ({ page }) => {
  // the task steps need "now" to sit safely inside one local day
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  test.skip(nowMin > 1430, 'in the last minutes before midnight a same-day time block no longer fits');

  await signIn(page);
  const banner = page.getByTestId('now-banner');
  await expect(banner).toHaveCount(0); // nothing timed yet

  // --- a calendar event happening right now
  const cal = await (await page.request.post('/api/v1/calendars', { headers: H, data: { name: 'Now Cal', url: 'http://localhost:3102/current.ics' } })).json();
  await expect(banner).toBeVisible({ timeout: 10_000 }); // SSE → refetch
  await expect(banner).toHaveAttribute('data-state', 'current');
  await expect(banner).toHaveAttribute('data-kind', 'event');
  await expect(banner).toContainText('Current event:');
  await expect(banner).toContainText('“Cal now”');
  await expect(banner).toContainText(/ends at ([A-Z][a-z]{2} )?\d{1,2}:\d{2}/);
  await expect(banner).toContainText(/\(\d+:\d{2} left\)/);

  // --- remove it; a task starting in the future today makes it "upcoming task"
  await page.request.delete(`/api/v1/calendars/${cal.id}`, { headers: H });
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
  const p = await (await page.request.post('/api/v1/projects', { headers: H, data: { name: 'Banner project' } })).json();
  const task = async (title: string) => (await (await page.request.post('/api/v1/tasks', { headers: H, data: { projectId: p.id, title } })).json()).id as string;

  const later = await task('Later today');
  const startLater = Math.min(nowMin + 90, 1425);
  // a start time that is still ahead; if it can't be (late evening) use tomorrow morning
  const futureToday = startLater > nowMin + 5;
  await page.request.put(`/api/v1/tasks/${later}/schedule`, {
    headers: H,
    data: futureToday ? { date: iso(0), startTime: hhmm(startLater), durationMinutes: Math.min(30, 1440 - startLater) } : { date: iso(1), startTime: '09:00', durationMinutes: 30 },
  });
  await expect(banner).toHaveAttribute('data-state', 'upcoming', { timeout: 10_000 });
  await expect(banner).toHaveAttribute('data-kind', 'task');
  await expect(banner).toContainText('Upcoming task:');
  await expect(banner).toContainText('“Later today”');
  await expect(banner).toContainText(/starts at /);
  await expect(banner).toContainText(/\(\d+:\d{2} away\)|\(\d+d \d+:\d{2} away\)/);

  // --- a task covering right now takes over as "current task"
  const now = await task('Doing this now');
  const start = Math.max(0, nowMin - 5);
  await page.request.put(`/api/v1/tasks/${now}/schedule`, { headers: H, data: { date: iso(0), startTime: hhmm(start), durationMinutes: Math.min(60, 1440 - start) } });
  await expect(banner).toHaveAttribute('data-state', 'current', { timeout: 10_000 });
  await expect(banner).toHaveAttribute('data-kind', 'task');
  await expect(banner).toContainText('Current task:');
  await expect(banner).toContainText('“Doing this now”');
  await expect(banner).toContainText(/ends at /);
  await expect(banner).toContainText(/left\)/);
  await page.screenshot({ path: 'e2e/.tmp/now-banner.png' });

  // --- completing it hands the banner back to the upcoming one
  await page.request.patch(`/api/v1/tasks/${now}`, { headers: H, data: { done: true } });
  await expect(banner).toHaveAttribute('data-state', 'upcoming', { timeout: 10_000 });
  await expect(banner).toContainText('“Later today”');

  // --- and clearing everything hides it
  await page.request.delete(`/api/v1/tasks/${later}`, { headers: H });
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
});

test('banner shows on every view and in the header on mobile too', async ({ page }) => {
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  test.skip(nowMin > 1430, 'in the last minutes before midnight a same-day time block no longer fits');
  await signIn(page);
  const p = await (await page.request.post('/api/v1/projects', { headers: H, data: { name: 'Banner nav' } })).json();
  const t = await (await page.request.post('/api/v1/tasks', { headers: H, data: { projectId: p.id, title: 'Always visible' } })).json();
  await page.request.put(`/api/v1/tasks/${t.id}/schedule`, { headers: H, data: { date: iso(0), startTime: hhmm(Math.max(0, nowMin - 5)), durationMinutes: Math.min(45, 1440 - Math.max(0, nowMin - 5)) } });
  for (const hash of ['#/', '#/list', '#/month', '#/gantt', '#/settings']) {
    await page.goto(`/${hash}`);
    await expect(page.getByTestId('now-banner')).toContainText('“Always visible”');
  }
  await page.request.delete(`/api/v1/tasks/${t.id}`, { headers: H });
});

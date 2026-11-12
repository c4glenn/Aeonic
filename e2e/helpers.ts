import { expect, type Page } from '@playwright/test';

export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password').fill('e2e-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Launch the garden shed' })).toBeVisible();
}

/** dnd-kit's MouseSensor needs real pointer movement, so drive the mouse in steps. */
export async function dragTo(page: Page, handleName: string, target: ReturnType<Page['locator']>) {
  const handle = page.getByRole('button', { name: handleName });
  const h = (await handle.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 20, h.y + 20, { steps: 4 });
  await page.mouse.move(t.x + t.width / 2, t.y + Math.min(80, t.height / 2), { steps: 12 });
  await page.mouse.up();
}

import { mkdirSync, rmSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { hashPassword } from './apps/api/src/auth';

mkdirSync('e2e/.tmp', { recursive: true });
for (const f of ['e2e.db', 'e2e.db-wal', 'e2e.db-shm']) rmSync(`e2e/.tmp/${f}`, { force: true });

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3101', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: 'pnpm --filter @todo/api start',
    url: 'http://localhost:3101/healthz',
    reuseExistingServer: false,
    env: {
      PORT: '3101',
      DATABASE_PATH: '../../e2e/.tmp/e2e.db',
      WEB_DIR: '../web/dist',
      ADMIN_PASSWORD_HASH: hashPassword('e2e-pass'),
      TZ: 'UTC',
    },
  },
});

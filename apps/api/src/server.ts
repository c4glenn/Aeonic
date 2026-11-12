import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app';
import { createDb } from './db';
import { loadConfig } from './env';

// Load the repo-root .env (when present); real environment variables win.
for (const path of ['../../.env', '.env']) {
  try {
    process.loadEnvFile(path);
    break;
  } catch {
    /* no .env here */
  }
}

const cfg = loadConfig();
const db = createDb(cfg.databasePath);
const { app, store } = createApp({ cfg, db });
store.seedIfEmpty();

if (cfg.webDir) {
  const root = cfg.webDir;
  app.use('/*', serveStatic({ root }));
  // SPA fallback
  app.get('*', (c) => c.html(readFileSync(join(root, 'index.html'), 'utf8')));
}

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}  (docs: /api/docs)`);
  if (!cfg.adminPasswordHash) console.warn('ADMIN_PASSWORD_HASH not set: web login disabled (tokens still work).');
});

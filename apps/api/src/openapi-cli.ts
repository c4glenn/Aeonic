import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from './app';
import { createDb } from './db';
import { loadConfig } from './env';

const { app, stop } = createApp({ cfg: loadConfig(), db: createDb(':memory:') });
const res = await app.request('/api/openapi.json');
mkdirSync('../../packages/client/src', { recursive: true });
writeFileSync('../../packages/client/openapi.json', JSON.stringify(await res.json(), null, 2) + '\n');
stop();
console.log('Wrote packages/client/openapi.json');

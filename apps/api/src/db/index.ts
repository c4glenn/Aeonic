import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from './migrate';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;

export function createDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  migrate(sqlite);
  return Object.assign(drizzle(sqlite, { schema }), { sqlite });
}
export { schema };

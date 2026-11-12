import type Database from 'better-sqlite3';

// Append-only list. Index+1 = PRAGMA user_version after applying.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
    importance INTEGER NOT NULL DEFAULT 2, archived INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 2, hard_due TEXT, soft_due TEXT, scheduled_date TEXT,
    done INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]', blocked_by TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE INDEX tasks_project ON tasks(project_id);
  CREATE INDEX tasks_scheduled ON tasks(scheduled_date);
  CREATE INDEX tasks_done ON tasks(done);
  CREATE TABLE tokens (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
    created_at TEXT NOT NULL, last_used_at TEXT
  );
  CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE webhooks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
  );
  CREATE TABLE webhook_deliveries (
    id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, event TEXT NOT NULL, attempt INTEGER NOT NULL,
    status INTEGER, error TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE idempotency (
    key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status INTEGER NOT NULL,
    body TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  `,
];

export function migrate(sqlite: Database.Database): void {
  const current = sqlite.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[i]!);
      sqlite.pragma(`user_version = ${i + 1}`);
    })();
  }
}

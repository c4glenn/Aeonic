import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>().notNull();

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  importance: integer('importance').notNull().default(2),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  tags: json<string[]>('tags'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  importance: integer('importance').notNull().default(2),
  hardDue: text('hard_due'),
  softDue: text('soft_due'),
  scheduledDate: text('scheduled_date'),
  startTime: text('start_time'),
  durationMinutes: integer('duration_minutes'),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  tags: json<string[]>('tags'),
  blockedBy: json<string[]>('blocked_by'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const tokens = sqliteTable('tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hash: text('hash').notNull(),
  scope: text('scope').notNull(), // 'read' | 'write'
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
});

export const sessions = sqliteTable('sessions', {
  hash: text('hash').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
});

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: json<string[]>('events'), // [] = all
  createdAt: text('created_at').notNull(),
});

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  event: text('event').notNull(),
  attempt: integer('attempt').notNull(),
  status: integer('status'), // HTTP status, null on network error
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

export const idempotency = sqliteTable('idempotency', {
  key: text('key').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  status: integer('status').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const calendars = sqliteTable('calendars', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  color: text('color').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  raw: text('raw'),
  fetchedAt: text('fetched_at'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

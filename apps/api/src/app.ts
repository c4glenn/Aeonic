import { createHash } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { cors } from 'hono/cors';
import { deleteCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import {
  authMiddleware,
  createLimiter,
  createSession,
  destroySession,
  randomToken,
  sha256,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type Env,
} from './auth';
import type { Config } from './env';
import type { Db } from './db';
import { schema } from './db';
import { Bus, startWebhookDispatcher, type WebhookOptions } from './events';
import { HttpError } from './problem';
import * as S from './schemas';
import { Store } from './service';

export interface AppOptions {
  cfg: Config;
  db: Db;
  clock?: () => Date;
  webhook?: WebhookOptions;
}

const problemContent = { 'application/json': { schema: S.Problem } };
const errs = {
  401: { description: 'Unauthorized', content: problemContent },
  404: { description: 'Not found', content: problemContent },
} as const;
const ok = <T extends z.ZodType>(schema: T, description = 'OK') => ({
  200: { description, content: { 'application/json': { schema } } },
});
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } }, required: true });
const idParam = z.object({ id: z.string() });
const ifMatch = (c: Context): number | undefined => {
  const h = c.req.header('if-match');
  if (!h) return undefined;
  const n = Number(h.replace(/"/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const etag = (c: Context, version: number) => c.header('ETag', `"${version}"`);

export function createApp(opts: AppOptions) {
  const { cfg, db } = opts;
  const bus = new Bus();
  const store = new Store(db, cfg, bus, opts.clock);
  const stopWebhooks = startWebhookDispatcher(db, bus, opts.webhook);

  const app = new OpenAPIHono<Env>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new HttpError(400, 'Validation failed', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), {
          issues: result.error.issues,
        });
      }
    },
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.body(JSON.stringify(err.toBody()), err.status as 400, { 'content-type': 'application/problem+json' });
    }
    console.error(err);
    return c.body(JSON.stringify(new HttpError(500, 'Internal Server Error').toBody()), 500, {
      'content-type': 'application/problem+json',
    });
  });
  app.notFound((c) =>
    c.body(JSON.stringify(new HttpError(404, 'Not Found', `No route for ${c.req.path}`).toBody()), 404, {
      'content-type': 'application/problem+json',
    }),
  );

  if (cfg.corsOrigins.length) {
    app.use('/api/*', cors({ origin: cfg.corsOrigins, credentials: true, exposeHeaders: ['ETag'] }));
  }

  app.get('/healthz', (c) => c.json({ ok: true }));

  // ---------- auth (public) ----------
  const loginLimit = createLimiter(10, 15 * 60 * 1000);
  app.post('/api/auth/login', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (!loginLimit.allowed(ip)) throw new HttpError(429, 'Too Many Requests', 'Try again later');
    if (!cfg.adminPasswordHash) throw new HttpError(503, 'Not configured', 'Set ADMIN_PASSWORD_HASH');
    const { password } = (await c.req.json().catch(() => ({}))) as { password?: string };
    if (!password || !(await verifyPassword(password, cfg.adminPasswordHash))) {
      loginLimit.fail(ip);
      throw new HttpError(401, 'Unauthorized', 'Wrong password');
    }
    loginLimit.reset(ip);
    const s = createSession(db);
    setCookie(c, SESSION_COOKIE, s.id, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: c.req.url.startsWith('https') || c.req.header('x-forwarded-proto') === 'https',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ ok: true });
  });
  app.post('/api/auth/logout', (c) => {
    const sid = (c.req.header('cookie') ?? '').match(/(?:^|; )sid=([^;]+)/)?.[1];
    if (sid) destroySession(db, sid);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ---------- protected /api/v1 ----------
  app.use('/api/v1/*', authMiddleware(db));

  // Idempotency-Key support for POST
  app.use('/api/v1/*', async (c, next) => {
    const key = c.req.header('idempotency-key');
    if (c.req.method !== 'POST' || !key) return next();
    const raw = await c.req.raw.clone().text();
    const fingerprint = createHash('sha256').update(`${c.req.path}\n${raw}`).digest('hex');
    const prior = db.select().from(schema.idempotency).where(eq(schema.idempotency.key, key)).get();
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new HttpError(422, 'Idempotency-Key reuse', 'Key was used with a different request');
      }
      return c.body(prior.body, prior.status as 200, { 'content-type': 'application/json', 'idempotent-replay': 'true' });
    }
    await next();
    if (c.res.status < 500 && c.res.headers.get('content-type')?.includes('json')) {
      const text = await c.res.clone().text();
      db.insert(schema.idempotency)
        .values({ key, fingerprint, status: c.res.status, body: text, createdAt: Date.now() })
        .onConflictDoNothing()
        .run();
    }
  });

  // ----- projects -----
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/projects', tags: ['Projects'], summary: 'List projects',
      request: { query: z.object({ archived: z.enum(['true', 'false']).optional() }) },
      responses: { ...ok(z.object({ items: z.array(S.ProjectSchema) })), 401: errs[401] },
    }),
    (c) => c.json({ items: store.listProjects(c.req.valid('query').archived === 'true') }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post', path: '/api/v1/projects', tags: ['Projects'], summary: 'Create a project',
      request: { body: body(S.ProjectCreate) },
      responses: { 201: { description: 'Created', content: { 'application/json': { schema: S.ProjectSchema } } }, 401: errs[401] },
    }),
    (c) => c.json(store.createProject(c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/projects/{id}', tags: ['Projects'], summary: 'Get a project',
      request: { params: idParam }, responses: { ...ok(S.ProjectSchema), ...errs },
    }),
    (c) => {
      const p = store.getProject(c.req.valid('param').id);
      etag(c, p.version);
      return c.json(p, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'patch', path: '/api/v1/projects/{id}', tags: ['Projects'], summary: 'Update a project (honors If-Match)',
      request: { params: idParam, body: body(S.ProjectPatch) }, responses: { ...ok(S.ProjectSchema), ...errs },
    }),
    (c) => {
      const p = store.updateProject(c.req.valid('param').id, c.req.valid('json'), ifMatch(c));
      etag(c, p.version);
      return c.json(p, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete', path: '/api/v1/projects/{id}', tags: ['Projects'], summary: 'Delete a project and its tasks',
      request: { params: idParam }, responses: { 204: { description: 'Deleted' }, ...errs },
    }),
    (c) => {
      store.deleteProject(c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  // ----- tasks -----
  const csv = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
  const TaskQuery = z.object({
    project: z.string().optional().openapi({ description: 'Comma-separated project ids' }),
    tag: z.string().optional().openapi({ description: 'Comma-separated tags (match any; task or project tags)' }),
    importance: z.string().optional().openapi({ description: 'Comma-separated levels, e.g. 3,4' }),
    status: z.enum(['open', 'done', 'all']).optional(),
    unblocked: z.enum(['true', 'false']).optional(),
    scheduledFrom: S.DateStr.optional(),
    scheduledTo: S.DateStr.optional(),
    dueBefore: S.DateStr.optional().openapi({ description: 'Hard or soft due on/before this date' }),
    sort: z.enum(['importance', 'urgency']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    cursor: z.string().optional(),
  });
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/tasks', tags: ['Tasks'], summary: 'List tasks',
      request: { query: TaskQuery },
      responses: { ...ok(z.object({ items: z.array(S.TaskSchema), nextCursor: z.string().nullable() })), 401: errs[401] },
    }),
    (c) => {
      const q = c.req.valid('query');
      return c.json(
        store.listTasks({
          projectIds: csv(q.project),
          tags: csv(q.tag)?.map((t) => t.toLowerCase()),
          importance: csv(q.importance)?.map(Number),
          status: q.status,
          unblocked: q.unblocked === undefined ? undefined : q.unblocked === 'true',
          scheduledFrom: q.scheduledFrom,
          scheduledTo: q.scheduledTo,
          dueBefore: q.dueBefore,
          sort: q.sort,
          limit: q.limit,
          cursor: q.cursor,
        }),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: 'post', path: '/api/v1/tasks', tags: ['Tasks'], summary: 'Create a task',
      request: { body: body(S.TaskCreate) },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: S.TaskSchema } } },
        401: errs[401],
        409: { description: 'Scheduled while blocked', content: problemContent },
        422: { description: 'Unknown blocker', content: problemContent },
      },
    }),
    (c) => c.json(store.createTask(c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/tasks/{id}', tags: ['Tasks'], summary: 'Get a task',
      request: { params: idParam }, responses: { ...ok(S.TaskSchema), ...errs },
    }),
    (c) => {
      const t = store.getTaskView(c.req.valid('param').id);
      etag(c, t.version);
      return c.json(t, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'patch', path: '/api/v1/tasks/{id}', tags: ['Tasks'], summary: 'Update a task (honors If-Match)',
      request: { params: idParam, body: body(S.TaskPatch) },
      responses: { ...ok(S.TaskSchema), ...errs, 412: { description: 'Version mismatch', content: problemContent } },
    }),
    (c) => {
      const t = store.updateTask(c.req.valid('param').id, c.req.valid('json'), ifMatch(c));
      etag(c, t.version);
      return c.json(t, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete', path: '/api/v1/tasks/{id}', tags: ['Tasks'], summary: 'Delete a task',
      request: { params: idParam }, responses: { 204: { description: 'Deleted' }, ...errs },
    }),
    (c) => {
      store.deleteTask(c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
  app.openapi(
    createRoute({
      method: 'put', path: '/api/v1/tasks/{id}/schedule', tags: ['Tasks'],
      summary: 'Schedule a task on a date', description: 'Fails with 409 (and the blockers) if the task is still blocked.',
      request: { params: idParam, body: body(z.object({ date: S.DateStr })) },
      responses: { ...ok(S.ScheduleResult), ...errs, 409: { description: 'Blocked', content: problemContent } },
    }),
    (c) => c.json(store.schedule(c.req.valid('param').id, c.req.valid('json').date), 200),
  );
  app.openapi(
    createRoute({
      method: 'delete', path: '/api/v1/tasks/{id}/schedule', tags: ['Tasks'], summary: 'Unschedule a task',
      request: { params: idParam }, responses: { ...ok(S.ScheduleResult), ...errs },
    }),
    (c) => c.json(store.unschedule(c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'post', path: '/api/v1/tasks/{id}/plan', tags: ['Tasks'],
      summary: 'Plan a task on a day (the drag-and-drop flow)',
      description: 'Without `goal` schedules the whole task. With `goal` creates a new scheduled child subtask.',
      request: { params: idParam, body: body(S.PlanBody) },
      responses: { ...ok(S.PlanResult), ...errs, 409: { description: 'Blocked', content: problemContent } },
    }),
    (c) => {
      const { date, goal } = c.req.valid('json');
      return c.json(store.plan(c.req.valid('param').id, date, goal), 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'put', path: '/api/v1/tasks/{id}/dependencies', tags: ['Tasks'],
      summary: 'Replace the list of tasks blocking this one',
      request: { params: idParam, body: body(z.object({ blockedBy: z.array(z.string()) })) },
      responses: { ...ok(S.TaskSchema), ...errs, 422: { description: 'Cycle or unknown id', content: problemContent } },
    }),
    (c) => c.json(store.setDependencies(c.req.valid('param').id, c.req.valid('json').blockedBy), 200),
  );

  // ----- week / tags -----
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/week', tags: ['Views'], summary: 'Seven-day planner view in one call',
      request: { query: z.object({ start: S.DateStr.optional().openapi({ description: 'Defaults to today' }) }) },
      responses: { ...ok(S.WeekSchema), 401: errs[401] },
    }),
    (c) => c.json(store.week(c.req.valid('query').start), 200),
  );
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/tags', tags: ['Tags'], summary: 'Tags in use, with counts',
      responses: { ...ok(z.object({ items: z.array(z.object({ name: z.string(), count: z.number().int() })) })), 401: errs[401] },
    }),
    (c) => c.json({ items: store.listTags() }, 200),
  );

  // ----- tokens -----
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/tokens', tags: ['Tokens'], summary: 'List API tokens',
      responses: { ...ok(z.object({ items: z.array(S.TokenSchema) })), 401: errs[401] },
    }),
    (c) => {
      const items = db.select().from(schema.tokens).all().map(({ hash: _h, ...t }) => ({ ...t, scope: t.scope as 'read' | 'write' }));
      return c.json({ items }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'post', path: '/api/v1/tokens', tags: ['Tokens'],
      summary: 'Create an API token', description: 'The secret is returned once and cannot be retrieved later.',
      request: { body: body(z.object({ name: z.string().min(1).max(80), scope: z.enum(['read', 'write']).default('write') })) },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: S.TokenSchema.extend({ token: z.string() }) } } },
        401: errs[401],
      },
    }),
    (c) => {
      const { name, scope } = c.req.valid('json');
      const secret = randomToken('tdt_');
      const row = { id: nanoid(10), name, hash: sha256(secret), scope, createdAt: new Date().toISOString(), lastUsedAt: null };
      db.insert(schema.tokens).values(row).run();
      return c.json({ id: row.id, name, scope, createdAt: row.createdAt, lastUsedAt: null, token: secret }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete', path: '/api/v1/tokens/{id}', tags: ['Tokens'], summary: 'Revoke an API token',
      request: { params: idParam }, responses: { 204: { description: 'Revoked' }, ...errs },
    }),
    (c) => {
      db.delete(schema.tokens).where(eq(schema.tokens.id, c.req.valid('param').id)).run();
      return c.body(null, 204);
    },
  );

  // ----- webhooks -----
  const publicHook = ({ secret: _s, ...h }: typeof schema.webhooks.$inferSelect) => h;
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/webhooks', tags: ['Webhooks'], summary: 'List webhooks',
      responses: { ...ok(z.object({ items: z.array(S.WebhookSchema) })), 401: errs[401] },
    }),
    (c) => c.json({ items: db.select().from(schema.webhooks).all().map(publicHook) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post', path: '/api/v1/webhooks', tags: ['Webhooks'],
      summary: 'Register a webhook',
      description:
        'Deliveries are POSTed as JSON with `X-Todo-Event` and `X-Todo-Signature: sha256=<hmac of body using the secret>`. ' +
        'Events: task.created|updated|deleted|scheduled|unscheduled|completed, project.created|updated|deleted. Empty `events` = all.',
      request: { body: body(z.object({ url: z.string().url(), events: z.array(z.string()).default([]), secret: z.string().min(16).optional() })) },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: S.WebhookSchema.extend({ secret: z.string() }) } } },
        401: errs[401],
      },
    }),
    (c) => {
      const { url, events, secret } = c.req.valid('json');
      const row = { id: nanoid(10), url, events, secret: secret ?? randomToken('whsec_'), createdAt: new Date().toISOString() };
      db.insert(schema.webhooks).values(row).run();
      return c.json({ id: row.id, url, events, createdAt: row.createdAt, secret: row.secret }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete', path: '/api/v1/webhooks/{id}', tags: ['Webhooks'], summary: 'Delete a webhook',
      request: { params: idParam }, responses: { 204: { description: 'Deleted' }, ...errs },
    }),
    (c) => {
      db.delete(schema.webhooks).where(eq(schema.webhooks.id, c.req.valid('param').id)).run();
      return c.body(null, 204);
    },
  );
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/webhooks/{id}/deliveries', tags: ['Webhooks'], summary: 'Recent delivery attempts',
      request: { params: idParam },
      responses: {
        ...ok(z.object({ items: z.array(z.object({ id: z.string(), event: z.string(), attempt: z.number(), status: z.number().nullable(), error: z.string().nullable(), createdAt: z.string() })) })),
        ...errs,
      },
    }),
    (c) => {
      const items = db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, c.req.valid('param').id)).all().slice(-100);
      return c.json({ items }, 200);
    },
  );

  // ----- export / import -----
  app.openapi(
    createRoute({
      method: 'get', path: '/api/v1/export', tags: ['Backup'], summary: 'Export all projects and tasks',
      responses: { ...ok(S.ExportSchema), 401: errs[401] },
    }),
    (c) => c.json(store.export(), 200),
  );
  app.openapi(
    createRoute({
      method: 'post', path: '/api/v1/import', tags: ['Backup'], summary: 'Replace all projects and tasks from an export',
      request: { body: body(S.ExportSchema) },
      responses: { ...ok(z.object({ projects: z.number(), tasks: z.number() })), 401: errs[401], 422: { description: 'Invalid', content: problemContent } },
    }),
    (c) => c.json(store.import(c.req.valid('json')), 200),
  );

  // ----- events (SSE) -----
  app.get('/api/v1/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsub = bus.subscribe((e) => void stream.writeSSE({ id: e.id, event: e.type, data: JSON.stringify(e) }));
      stream.onAbort(unsub);
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: 'ping', data: '{}' });
      }
    }),
  );

  // ----- docs -----
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', { type: 'http', scheme: 'bearer' });
  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Todo Tool API',
      version: '1.0.0',
      description:
        'Authenticate with `Authorization: Bearer <token>` (create tokens in Settings). Errors are RFC 9457 problem+json. ' +
        '`POST` honors `Idempotency-Key`; `PATCH` honors `If-Match` with the ETag from GET. `GET /api/v1/events` streams server-sent events.',
    },
    security: [{ bearer: [] }],
  });
  app.get('/api/docs', Scalar({ url: '/api/openapi.json', theme: 'purple' }));

  return { app, store, bus, stop: stopWebhooks };
}

import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword, sha256 } from './auth';
import { createDb } from './db';
import { loadConfig } from './env';
import { sign } from './events';

const NOW = new Date('2026-11-11T12:00:00Z');

function setup(extra: Parameters<typeof createApp>[0]['webhook'] = { retryDelays: [0] }) {
  const cfg = { ...loadConfig({}), adminPasswordHash: hashPassword('pw'), timeZone: 'UTC' };
  const ctx = createApp({ cfg, db: createDb(':memory:'), clock: () => NOW, webhook: extra });
  const secret = 'aet_test';
  ctx.store.db.sqlite
    .prepare("INSERT INTO tokens (id,name,hash,scope,created_at) VALUES ('t1','w',?,'write','x'),('t2','r',?,'read','x')")
    .run(sha256(secret), sha256('aet_ro'));
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, token = secret) => {
    const res = await ctx.app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { ...ctx, call };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

async function chain() {
  const p = (await t.call('POST', '/api/v1/projects', { name: 'P', tags: ['Work'] })).json;
  const a = (await t.call('POST', '/api/v1/tasks', { projectId: p.id, title: 'A', softDue: '2026-12-01' })).json;
  const b = (await t.call('POST', '/api/v1/tasks', { projectId: p.id, title: 'B', blockedBy: [a.id], hardDue: '2026-11-14' })).json;
  const c = (await t.call('POST', '/api/v1/tasks', { projectId: p.id, title: 'C', blockedBy: [b.id] })).json;
  return { p, a, b, c };
}

describe('auth', () => {
  it('rejects missing/invalid tokens and enforces read scope', async () => {
    expect((await t.call('GET', '/api/v1/tasks', undefined, {}, 'nope')).status).toBe(401);
    expect((await t.call('GET', '/api/v1/tasks', undefined, {}, 'aet_ro')).status).toBe(200);
    const w = await t.call('POST', '/api/v1/projects', { name: 'x' }, {}, 'aet_ro');
    expect(w.status).toBe(403);
    expect(w.json.title).toBe('Forbidden');
  });
  it('supports password login with cookie and requires CSRF header to mutate', async () => {
    const bad = await t.app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) });
    expect(bad.status).toBe(401);
    const login = await t.app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    expect((await t.app.request('/api/v1/tasks', { headers: { cookie } })).status).toBe(200);
    const noCsrf = await t.app.request('/api/v1/projects', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"name":"x"}' });
    expect(noCsrf.status).toBe(403);
    const ok = await t.app.request('/api/v1/projects', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'aeonic-web' },
      body: '{"name":"x"}',
    });
    expect(ok.status).toBe(201);
  });
});

describe('password hashes', () => {
  it('generates a $-free hash and still accepts the original $-separated format', async () => {
    const { verifyPassword, hashPassword } = await import('./auth');
    const h = hashPassword('s3cret');
    expect(h).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    expect(h).not.toContain('$');
    expect(await verifyPassword('s3cret', h)).toBe(true);
    expect(await verifyPassword('nope', h)).toBe(false);
    expect(await verifyPassword('s3cret', h.replace(/:/g, '$'))).toBe(true);
    expect(await verifyPassword('s3cret', ` ${h}\n`)).toBe(true); // stray whitespace from a pasted env value
    expect(await verifyPassword('s3cret', 'garbage')).toBe(false);
  });
});

describe('login rate limit', () => {
  it('locks out after repeated failures but never counts successes', async () => {
    const login = (password: string) =>
      t.app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
    for (let i = 0; i < 15; i++) expect((await login('pw')).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await login('bad')).status).toBe(401);
    expect((await login('pw')).status).toBe(429);
  });
});

describe('scheduling & dependencies', () => {
  it('blocks scheduling until the blocker is scheduled, then unlocks (409 lists blockers)', async () => {
    const { a, b } = await chain();
    expect((await t.call('GET', `/api/v1/tasks/${b.id}`)).json.unblocked).toBe(false);
    const blocked = await t.call('PUT', `/api/v1/tasks/${b.id}/schedule`, { date: '2026-11-13' });
    expect(blocked.status).toBe(409);
    expect(blocked.json.blockers).toEqual([{ id: a.id, title: 'A' }]);

    expect((await t.call('PUT', `/api/v1/tasks/${a.id}/schedule`, { date: '2026-11-12' })).status).toBe(200);
    expect((await t.call('GET', `/api/v1/tasks/${b.id}`)).json.unblocked).toBe(true);
    expect((await t.call('PUT', `/api/v1/tasks/${b.id}/schedule`, { date: '2026-11-13' })).status).toBe(200);

    const un = await t.call('DELETE', `/api/v1/tasks/${a.id}/schedule`);
    expect(un.json.scheduledDependents.map((x: { id: string }) => x.id)).toEqual([b.id]);
  });

  it('rejects dependency cycles with 422', async () => {
    const { a, c } = await chain();
    const r = await t.call('PUT', `/api/v1/tasks/${a.id}/dependencies`, { blockedBy: [c.id] });
    expect(r.status).toBe(422);
    expect(r.json.title).toBe('Dependency cycle');
  });

  it('plan: whole task vs new child subtask', async () => {
    const { a } = await chain();
    const child = await t.call('POST', `/api/v1/tasks/${a.id}/plan`, { date: '2026-11-12', goal: 'Draft on paper' });
    expect(child.json.created).toBe(true);
    expect(child.json.task).toMatchObject({ title: 'Draft on paper', parentId: a.id, scheduledDate: '2026-11-12' });
    expect((await t.call('GET', `/api/v1/tasks/${a.id}`)).json.scheduledDate).toBeNull();

    const whole = await t.call('POST', `/api/v1/tasks/${a.id}/plan`, { date: '2026-11-13' });
    expect(whole.json.created).toBe(false);
    expect(whole.json.task.scheduledDate).toBe('2026-11-13');
  });
});

describe('multiple blockers', () => {
  async function trio() {
    const p1 = (await t.call('POST', '/api/v1/projects', { name: 'One' })).json;
    const p2 = (await t.call('POST', '/api/v1/projects', { name: 'Two' })).json;
    const mk = async (projectId: string, title: string, extra: object = {}) =>
      (await t.call('POST', '/api/v1/tasks', { projectId, title, ...extra })).json;
    const a = await mk(p1.id, 'A');
    const b = await mk(p2.id, 'B'); // a different project
    const c = await mk(p1.id, 'C', { blockedBy: [a.id, b.id] });
    return { a, b, c };
  }
  const view = async (id: string) => (await t.call('GET', `/api/v1/tasks/${id}`)).json;

  it('stays locked until EVERY blocker is scheduled or done, across projects', async () => {
    const { a, b, c } = await trio();
    expect((await view(c.id)).blockedBy.sort()).toEqual([a.id, b.id].sort());
    expect((await view(c.id)).blockers).toHaveLength(2);

    await t.call('PUT', `/api/v1/tasks/${a.id}/schedule`, { date: '2026-11-12' });
    const half = await view(c.id);
    expect(half.unblocked).toBe(false);
    expect(half.blockers).toEqual([{ id: b.id, title: 'B' }]); // only the outstanding one is listed
    const refused = await t.call('PUT', `/api/v1/tasks/${c.id}/schedule`, { date: '2026-11-13' });
    expect(refused.status).toBe(409);
    expect(refused.json.blockers).toEqual([{ id: b.id, title: 'B' }]);

    // completing counts as ready, just like scheduling
    await t.call('PATCH', `/api/v1/tasks/${b.id}`, { done: true });
    expect((await view(c.id)).unblocked).toBe(true);
    expect((await t.call('PUT', `/api/v1/tasks/${c.id}/schedule`, { date: '2026-11-13' })).status).toBe(200);
  });

  it('un-scheduling one of several blockers re-locks the dependent', async () => {
    const { a, b, c } = await trio();
    for (const id of [a.id, b.id]) await t.call('PUT', `/api/v1/tasks/${id}/schedule`, { date: '2026-11-12' });
    expect((await view(c.id)).unblocked).toBe(true);
    const un = await t.call('DELETE', `/api/v1/tasks/${a.id}/schedule`);
    expect(un.status).toBe(200);
    expect((await view(c.id)).unblocked).toBe(false);
  });

  it('replacing the blocker list, removing one, and clearing all', async () => {
    const { a, b, c } = await trio();
    const one = await t.call('PUT', `/api/v1/tasks/${c.id}/dependencies`, { blockedBy: [b.id] });
    expect(one.json.blockedBy).toEqual([b.id]);
    expect((await view(a.id)).blocks).toEqual([]);
    expect((await view(b.id)).blocks).toEqual([c.id]);
    expect((await t.call('PUT', `/api/v1/tasks/${c.id}/dependencies`, { blockedBy: [] })).json.unblocked).toBe(true);
    // duplicates collapse
    expect((await t.call('PUT', `/api/v1/tasks/${c.id}/dependencies`, { blockedBy: [a.id, a.id, b.id] })).json.blockedBy).toHaveLength(2);
  });

  it('rejects cycles through a task with several parents, and unknown ids', async () => {
    const { a, b, c } = await trio();
    // c depends on a and b; making a depend on c (directly) or b depend on c would close a loop
    expect((await t.call('PUT', `/api/v1/tasks/${a.id}/dependencies`, { blockedBy: [c.id] })).status).toBe(422);
    expect((await t.call('PUT', `/api/v1/tasks/${b.id}/dependencies`, { blockedBy: [a.id, c.id] })).status).toBe(422);
    expect((await t.call('PUT', `/api/v1/tasks/${b.id}/dependencies`, { blockedBy: [a.id] })).status).toBe(200); // diamond is fine
    expect((await t.call('PUT', `/api/v1/tasks/${c.id}/dependencies`, { blockedBy: [a.id, 'nope'] })).status).toBe(422);
  });

  it('deleting one blocker removes it from the list and may unlock the task', async () => {
    const { a, b, c } = await trio();
    await t.call('PUT', `/api/v1/tasks/${a.id}/schedule`, { date: '2026-11-12' });
    await t.call('DELETE', `/api/v1/tasks/${b.id}`);
    const after = await view(c.id);
    expect(after.blockedBy).toEqual([a.id]);
    expect(after.unblocked).toBe(true);
  });
});

describe('urgency, filters, sort', () => {
  it('inherits urgency from the downstream tree', async () => {
    const { a, c } = await chain();
    const ta = (await t.call('GET', `/api/v1/tasks/${a.id}`)).json;
    expect(ta.urgency).toEqual({ days: 3, kind: 'hard', sourceTaskId: expect.any(String) });
    expect((await t.call('GET', `/api/v1/tasks/${c.id}`)).json.urgency).toBeNull();
  });

  it('filters by tag/unblocked and sorts', async () => {
    const { p, a } = await chain();
    const hi = (await t.call('POST', '/api/v1/tasks', { projectId: p.id, title: 'Hi', importance: 4 })).json;
    const unblocked = (await t.call('GET', '/api/v1/tasks?unblocked=true&tag=work&sort=importance')).json.items;
    expect(unblocked.map((x: { id: string }) => x.id)).toEqual([hi.id, a.id]);
    expect((await t.call('GET', '/api/v1/tasks?tag=nothing')).json.items).toHaveLength(0);
    const byUrgency = (await t.call('GET', '/api/v1/tasks?sort=urgency')).json.items;
    expect(byUrgency[0].id).toBe(a.id);
  });

  it('paginates with cursors', async () => {
    await chain();
    const page1 = (await t.call('GET', '/api/v1/tasks?limit=2')).json;
    expect(page1.items).toHaveLength(2);
    const page2 = (await t.call('GET', `/api/v1/tasks?limit=2&cursor=${page1.nextCursor}`)).json;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});

describe('week view', () => {
  it('returns 7 days with weekend flag, scheduled tasks and due markers', async () => {
    const { a, b } = await chain();
    await t.call('PUT', `/api/v1/tasks/${a.id}/schedule`, { date: '2026-11-12' });
    const w = (await t.call('GET', '/api/v1/week')).json;
    expect(w.start).toBe('2026-11-11');
    expect(w.days).toHaveLength(7);
    expect(w.days.filter((d: { weekend: boolean }) => d.weekend).map((d: { date: string }) => d.date)).toEqual(['2026-11-14', '2026-11-15']);
    expect(w.days[1].tasks.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect(w.days[3].dueMarkers).toEqual([{ taskId: b.id, projectId: expect.any(String), title: 'B', kind: 'hard' }]);
  });
});

describe('http semantics', () => {
  it('ETag / If-Match', async () => {
    const { a } = await chain();
    const got = await t.call('GET', `/api/v1/tasks/${a.id}`);
    const tag = got.headers.get('etag')!;
    expect((await t.call('PATCH', `/api/v1/tasks/${a.id}`, { title: 'A2' }, { 'if-match': tag })).status).toBe(200);
    expect((await t.call('PATCH', `/api/v1/tasks/${a.id}`, { title: 'A3' }, { 'if-match': tag })).status).toBe(412);
  });
  it('Idempotency-Key replays the same response', async () => {
    const h = { 'idempotency-key': 'k1' };
    const r1 = await t.call('POST', '/api/v1/projects', { name: 'Once' }, h);
    const r2 = await t.call('POST', '/api/v1/projects', { name: 'Once' }, h);
    expect(r2.json.id).toBe(r1.json.id);
    expect(r2.headers.get('idempotent-replay')).toBe('true');
    expect((await t.call('POST', '/api/v1/projects', { name: 'Different' }, h)).status).toBe(422);
    expect((await t.call('GET', '/api/v1/projects')).json.items).toHaveLength(1);
  });
  it('validation errors are problem+json 400', async () => {
    const r = await t.call('POST', '/api/v1/tasks', { title: '' });
    expect(r.status).toBe(400);
    expect(r.json.title).toBe('Validation failed');
  });
  it('serves OpenAPI 3.1 and docs', async () => {
    const spec = await t.app.request('/api/openapi.json');
    const j = await spec.json();
    expect(j.openapi).toBe('3.1.0');
    expect(Object.keys(j.paths)).toContain('/api/v1/tasks/{id}/plan');
    expect((await t.app.request('/api/docs')).status).toBe(200);
  });
});

describe('export/import', () => {
  it('round-trips and rejects cycles', async () => {
    await chain();
    const dump = (await t.call('GET', '/api/v1/export')).json;
    const t2 = setup();
    const imp = await t2.call('POST', '/api/v1/import', dump);
    expect(imp.json).toEqual({ projects: 1, tasks: 3 });
    expect((await t2.call('GET', '/api/v1/tasks')).json.items).toHaveLength(3);
    dump.tasks[0].blockedBy = [dump.tasks[2].id];
    expect((await t2.call('POST', '/api/v1/import', dump)).status).toBe(422);
  });
});

describe('events & webhooks', () => {
  it('emits events on the bus', async () => {
    const seen: string[] = [];
    t.bus.subscribe((e) => seen.push(e.type));
    const { a } = await chain();
    await t.call('PUT', `/api/v1/tasks/${a.id}/schedule`, { date: '2026-11-12' });
    await t.call('PATCH', `/api/v1/tasks/${a.id}`, { done: true });
    expect(seen).toContain('task.scheduled');
    expect(seen).toContain('task.completed');
  });

  it('delivers signed webhooks and logs attempts', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const t3 = setup({
      retryDelays: [0],
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch,
    });
    const hook = (await t3.call('POST', '/api/v1/webhooks', { url: 'http://hook.test/x', events: ['project.created'] })).json;
    await t3.call('POST', '/api/v1/projects', { name: 'Hooked' });
    await t3.call('POST', '/api/v1/tasks', { projectId: 'nope', title: 'ignored' });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['x-aeonic-signature']).toBe(sign(hook.secret, calls[0]!.body));
    const log = (await t3.call('GET', `/api/v1/webhooks/${hook.id}/deliveries`)).json.items;
    expect(log[0]).toMatchObject({ event: 'project.created', status: 200, attempt: 1 });
  });
});

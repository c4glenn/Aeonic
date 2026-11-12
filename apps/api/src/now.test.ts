import { describe, expect, it } from 'vitest';
import type { Task } from '@aeonic/domain';
import { createApp } from './app';
import { sha256 } from './auth';
import type { CalendarEventView } from './calendars';
import { createDb } from './db';
import { loadConfig } from './env';
import { computeNow } from './now';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, projectId: 'p', parentId: null, title: id, importance: 2, hardDue: null, softDue: null,
  scheduledDate: '2026-11-11', startTime: '10:00', durationMinutes: 60, done: false, tags: [], blockedBy: [], ...over,
});
const event = (id: string, start: string, end: string, over: Partial<CalendarEventView> = {}): CalendarEventView => ({
  id, uid: id, title: id, start, end, allDay: false, location: null, calendarId: 'c', calendarName: 'Work', color: 'sky', ...over,
});
const at = (iso: string) => Date.parse(iso);
const base = { tz: 'UTC', projectNames: new Map([['p', 'Proj']]) };

describe('computeNow', () => {
  it('finds the current item; start is inclusive, end is exclusive', () => {
    const t = task('write'); // 10:00–11:00 UTC
    const run = (iso: string) => computeNow({ ...base, nowMs: at(iso), tasks: [t], events: [] });
    expect(run('2026-11-11T09:59:59Z').current).toBeNull();
    expect(run('2026-11-11T10:00:00Z').current).toMatchObject({ kind: 'task', id: 'write', projectName: 'Proj' });
    expect(run('2026-11-11T10:59:59Z').current?.id).toBe('write');
    expect(run('2026-11-11T11:00:00Z').current).toBeNull();
  });

  it('upcoming: earliest start after now, across tasks and events', () => {
    const r = computeNow({
      ...base, nowMs: at('2026-11-11T08:00:00Z'),
      tasks: [task('late', { startTime: '13:00' }), task('early', { startTime: '09:30' })],
      events: [event('mid', '2026-11-11T11:00:00Z', '2026-11-11T12:00:00Z')],
    });
    expect(r.current).toBeNull();
    expect(r.next).toMatchObject({ kind: 'task', id: 'early' });
  });

  it('mixes kinds, and next is still reported while something is current', () => {
    const r = computeNow({
      ...base, nowMs: at('2026-11-11T10:30:00Z'),
      tasks: [task('write')],
      events: [event('review', '2026-11-11T12:00:00Z', '2026-11-11T13:00:00Z')],
    });
    expect(r.current?.id).toBe('write');
    expect(r.next).toMatchObject({ kind: 'event', id: 'review', calendarName: 'Work', calendarColor: 'sky' });
  });

  it('with overlaps, current is the one ending soonest', () => {
    const r = computeNow({
      ...base, nowMs: at('2026-11-11T10:30:00Z'),
      tasks: [task('long', { durationMinutes: 120 })], // ends 12:00
      events: [event('short', '2026-11-11T10:15:00Z', '2026-11-11T10:45:00Z')],
    });
    expect(r.current?.id).toBe('short');
  });

  it('ignores done, untimed and all-day items', () => {
    const r = computeNow({
      ...base, nowMs: at('2026-11-11T10:30:00Z'),
      tasks: [task('done', { done: true }), task('untimed', { startTime: null, durationMinutes: null })],
      events: [event('holiday', '2026-11-11', '2026-11-12', { allDay: true })],
    });
    expect(r).toMatchObject({ current: null, next: null });
  });

  it("reads a task's wall-clock time in the requested zone", () => {
    const t = task('write'); // 10:00 wall clock
    const ny = computeNow({ tz: 'America/New_York', projectNames: base.projectNames, nowMs: at('2026-11-11T15:30:00Z'), tasks: [t], events: [] });
    expect(ny.current?.start).toBe('2026-11-11T15:00:00.000Z'); // 10:00 EST
    const utc = computeNow({ ...base, nowMs: at('2026-11-11T15:30:00Z'), tasks: [t], events: [] });
    expect(utc.current).toBeNull();
  });
});

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN',
  'BEGIN:VEVENT', 'UID:a@x', 'DTSTART:20261111T140000Z', 'DTEND:20261111T150000Z', 'SUMMARY:Design review', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:h@x', 'DTSTART;VALUE=DATE:20261111', 'DTEND;VALUE=DATE:20261112', 'SUMMARY:Holiday', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b@x', 'DTSTART:20261112T090000Z', 'DTEND:20261112T100000Z', 'SUMMARY:Tomorrow sync', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

function setup() {
  const ctx = createApp({
    cfg: { ...loadConfig({}), timeZone: 'UTC' },
    db: createDb(':memory:'),
    clock: () => new Date('2026-11-11T12:00:00Z'),
    fetch: (async () => new Response(ICS)) as unknown as typeof fetch,
  });
  ctx.store.db.sqlite
    .prepare("INSERT INTO tokens (id,name,hash,scope,created_at) VALUES ('t1','w',?,'write','x')")
    .run(sha256('aet_test'));
  const call = async (method: string, path: string, body?: unknown, token: string | null = 'aet_test') => {
    const res = await ctx.app.request(path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : null };
  };
  return { ...ctx, call };
}

describe('GET /api/v1/now', () => {
  it('reports the current event, ignoring the all-day one; next is the following event', async () => {
    const t = setup();
    await t.call('POST', '/api/v1/calendars', { name: 'Work', url: 'https://cal.example.com/a.ics' });
    const r = (await t.call('GET', '/api/v1/now?at=2026-11-11T14:30:00Z')).json;
    expect(r.current).toMatchObject({ kind: 'event', title: 'Design review', calendarName: 'Work', start: '2026-11-11T14:00:00.000Z', end: '2026-11-11T15:00:00.000Z' });
    expect(r.next).toMatchObject({ kind: 'event', title: 'Tomorrow sync' });
  });

  it('before the first event: nothing current, upcoming is the event; far future: nothing', async () => {
    const t = setup();
    await t.call('POST', '/api/v1/calendars', { name: 'Work', url: 'https://cal.example.com/a.ics' });
    const early = (await t.call('GET', '/api/v1/now?at=2026-11-11T13:00:00Z')).json;
    expect(early.current).toBeNull();
    expect(early.next.title).toBe('Design review');
    const late = (await t.call('GET', '/api/v1/now?at=2027-06-01T00:00:00Z')).json;
    expect(late).toMatchObject({ current: null, next: null });
  });

  it('tasks and events compete on the same timeline; tz changes how task times are read', async () => {
    const t = setup();
    const p = (await t.call('POST', '/api/v1/projects', { name: 'Garden' })).json;
    const id = (await t.call('POST', '/api/v1/tasks', { projectId: p.id, title: 'Dig' })).json.id;
    await t.call('PUT', `/api/v1/tasks/${id}/schedule`, { date: '2026-11-11', startTime: '10:00', durationMinutes: 60 });

    const ny = (await t.call('GET', '/api/v1/now?tz=America/New_York&at=2026-11-11T15:10:00Z')).json; // 10:10 EST
    expect(ny.current).toMatchObject({ kind: 'task', title: 'Dig', projectName: 'Garden', start: '2026-11-11T15:00:00.000Z' });
    const utc = (await t.call('GET', '/api/v1/now?tz=UTC&at=2026-11-11T15:10:00Z')).json; // task was 10:00 UTC
    expect(utc.current).toBeNull();

    await t.call('PATCH', `/api/v1/tasks/${id}`, { done: true });
    expect((await t.call('GET', '/api/v1/now?tz=America/New_York&at=2026-11-11T15:10:00Z')).json.current).toBeNull();
  });

  it('defaults to the server clock, validates tz, and needs auth', async () => {
    const t = setup();
    const r = (await t.call('GET', '/api/v1/now')).json;
    expect(r.now).toBe('2026-11-11T12:00:00.000Z');
    expect((await t.call('GET', '/api/v1/now?tz=Mars/Olympus')).status).toBe(400);
    expect((await t.call('GET', '/api/v1/now?at=yesterday')).status).toBe(400);
    expect((await t.call('GET', '/api/v1/now', undefined, null)).status).toBe(401);
  });
});

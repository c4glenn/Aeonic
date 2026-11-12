import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { sha256 } from './auth';
import { createDb } from './db';
import { loadConfig } from './env';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:20071104T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:20070311T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly@x
DTSTART;TZID=America/New_York:20261102T090000
DTEND;TZID=America/New_York:20261102T100000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=America/New_York:20261116T090000
SUMMARY:Standup
LOCATION:Room 4
END:VEVENT
BEGIN:VEVENT
UID:weekly@x
RECURRENCE-ID;TZID=America/New_York:20261109T090000
DTSTART;TZID=America/New_York:20261109T130000
DTEND;TZID=America/New_York:20261109T140000
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:allday@x
DTSTART;VALUE=DATE:20261112
DTEND;VALUE=DATE:20261115
SUMMARY:Offsite
END:VEVENT
BEGIN:VEVENT
UID:utc@x
DTSTART:20261113T180000Z
DTEND:20261113T190000Z
SUMMARY:UTC call
END:VEVENT
END:VCALENDAR`;

const SECRET_URL = 'webcal://cal.example.com/private/abc123secret/basic.ics';

function setup(respond: () => Response | Promise<Response> = () => new Response(ICS, { status: 200 })) {
  const fetched: string[] = [];
  const fakeFetch = (async (url: URL | string) => {
    fetched.push(String(url));
    return respond();
  }) as unknown as typeof fetch;
  const ctx = createApp({
    cfg: { ...loadConfig({}), timeZone: 'UTC' },
    db: createDb(':memory:'),
    clock: () => new Date('2026-11-11T12:00:00Z'),
    fetch: fakeFetch,
    webhook: { retryDelays: [0] },
  });
  ctx.store.db.sqlite
    .prepare("INSERT INTO tokens (id,name,hash,scope,created_at) VALUES ('t1','w',?,'write','x'),('t2','r',?,'read','x')")
    .run(sha256('aet_test'), sha256('aet_ro'));
  const call = async (method: string, path: string, body?: unknown, token = 'aet_test') => {
    const res = await ctx.app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : null };
  };
  return { ...ctx, call, fetched };
}

describe('ICS calendars', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('subscribes via webcal://, never exposes the full URL, and fetches over https', async () => {
    const r = await t.call('POST', '/api/v1/calendars', { name: 'Work', url: SECRET_URL });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ name: 'Work', source: 'cal.example.com', enabled: true, error: null });
    expect(JSON.stringify(r.json)).not.toContain('abc123secret');
    expect(t.fetched[0]).toBe('https://cal.example.com/private/abc123secret/basic.ics');
    expect(JSON.stringify((await t.call('GET', '/api/v1/calendars')).json)).not.toContain('abc123secret');
  });

  it('expands recurrences, honors exceptions and moved occurrences, converts time zones', async () => {
    await t.call('POST', '/api/v1/calendars', { name: 'Work', url: SECRET_URL });
    const { items } = (await t.call('GET', '/api/v1/calendar-events?from=2026-11-01&to=2026-11-30')).json;
    const standups = items.filter((e: { uid: string }) => e.uid === 'weekly@x');
    expect(standups.map((e: { start: string }) => e.start)).toEqual([
      '2026-11-02T14:00:00.000Z', // 09:00 EST
      '2026-11-09T18:00:00.000Z', // moved to 13:00 EST
      '2026-11-23T14:00:00.000Z', // the 16th is an EXDATE
      '2026-11-30T14:00:00.000Z',
    ]);
    expect(standups.find((e: { title: string }) => e.title === 'Standup (moved)')).toBeTruthy();
    expect(standups[0]).toMatchObject({ allDay: false, location: 'Room 4', calendarName: 'Work', color: 'sky' });

    const offsite = items.find((e: { uid: string }) => e.uid === 'allday@x');
    expect(offsite).toMatchObject({ allDay: true, start: '2026-11-12', end: '2026-11-15' });
    expect(items.find((e: { uid: string }) => e.uid === 'utc@x')).toMatchObject({ start: '2026-11-13T18:00:00.000Z', end: '2026-11-13T19:00:00.000Z' });
  });

  it('only returns events overlapping the requested range', async () => {
    await t.call('POST', '/api/v1/calendars', { name: 'Work', url: SECRET_URL });
    const { items } = (await t.call('GET', '/api/v1/calendar-events?from=2026-11-20&to=2026-11-20')).json;
    expect(items.map((e: { uid: string }) => e.uid)).toEqual([]);
    // the window is padded by a day or two so clients can clip per local day
    const wide = (await t.call('GET', '/api/v1/calendar-events?from=2026-11-12&to=2026-11-12')).json.items;
    expect(wide.map((e: { uid: string }) => e.uid)).toContain('allday@x');
    expect(wide.map((e: { uid: string }) => e.uid)).not.toContain('weekly@x');
  });

  it('rejects bad links: scheme, non-ICS, HTTP errors, bad ranges', async () => {
    expect((await t.call('POST', '/api/v1/calendars', { name: 'x', url: 'ftp://example.com/a.ics' })).status).toBe(422);
    expect((await t.call('POST', '/api/v1/calendars', { name: 'x', url: 'not a url at all' })).status).toBe(422);
    const html = setup(() => new Response('<html>hi</html>', { status: 200 }));
    expect((await html.call('POST', '/api/v1/calendars', { name: 'x', url: 'https://example.com/page' })).status).toBe(422);
    const down = setup(() => new Response('nope', { status: 404 }));
    expect((await down.call('POST', '/api/v1/calendars', { name: 'x', url: 'https://example.com/a.ics' })).status).toBe(502);
    expect((await down.call('GET', '/api/v1/calendars')).json.items).toHaveLength(0);
    expect((await t.call('GET', '/api/v1/calendar-events?from=2026-11-10&to=2026-11-01')).status).toBe(422);
  });

  it('disable hides events; failed refresh keeps old data and records the error; delete removes', async () => {
    const cal = (await t.call('POST', '/api/v1/calendars', { name: 'Work', url: SECRET_URL })).json;
    const range = '/api/v1/calendar-events?from=2026-11-12&to=2026-11-12';
    const offsite = async (x: typeof t) =>
      (await x.call('GET', range)).json.items.filter((e: { uid: string }) => e.uid === 'allday@x');

    await t.call('PATCH', `/api/v1/calendars/${cal.id}`, { enabled: false });
    expect(await offsite(t)).toHaveLength(0);
    await t.call('PATCH', `/api/v1/calendars/${cal.id}`, { enabled: true, color: 'pink', name: 'Renamed' });
    expect((await offsite(t))[0]).toMatchObject({ color: 'pink', calendarName: 'Renamed' });

    const failing = setup(); // subscribe OK, then make the server fail
    await failing.call('POST', '/api/v1/calendars', { name: 'W', url: SECRET_URL });
    const id = (await failing.call('GET', '/api/v1/calendars')).json.items[0].id;
    (failing as unknown as { calendars: { doFetch: typeof fetch } }).calendars['doFetch'] = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    const r = await failing.call('POST', `/api/v1/calendars/${id}/refresh`);
    expect(r.json.error).toMatch(/HTTP 500/);
    expect(await offsite(failing)).toHaveLength(1); // old data kept

    expect((await t.call('DELETE', `/api/v1/calendars/${cal.id}`)).status).toBe(204);
    expect((await t.call('GET', range)).json.items).toHaveLength(0);
    expect((await t.call('DELETE', `/api/v1/calendars/${cal.id}`)).status).toBe(404);
  });

  it('read-only tokens can read but not subscribe', async () => {
    await t.call('POST', '/api/v1/calendars', { name: 'Work', url: SECRET_URL });
    expect((await t.call('GET', '/api/v1/calendars', undefined, 'aet_ro')).status).toBe(200);
    expect((await t.call('POST', '/api/v1/calendars', { name: 'x', url: SECRET_URL }, 'aet_ro')).status).toBe(403);
  });
});

describe('timed task blocks', () => {
  let t: ReturnType<typeof setup>;
  let taskId: string;
  beforeEach(async () => {
    t = setup();
    const p = (await t.call('POST', '/api/v1/projects', { name: 'P' })).json;
    taskId = (await t.call('POST', '/api/v1/tasks', { projectId: p.id, title: 'Write' })).json.id;
  });

  it('defaults to 30 minutes, accepts a duration, and untimed scheduling clears the time', async () => {
    let r = await t.call('PUT', `/api/v1/tasks/${taskId}/schedule`, { date: '2026-11-12', startTime: '14:30' });
    expect(r.json.task).toMatchObject({ scheduledDate: '2026-11-12', startTime: '14:30', durationMinutes: 30 });

    r = await t.call('PUT', `/api/v1/tasks/${taskId}/schedule`, { date: '2026-11-13', startTime: '09:00', durationMinutes: 90 });
    expect(r.json.task).toMatchObject({ startTime: '09:00', durationMinutes: 90 });

    r = await t.call('PUT', `/api/v1/tasks/${taskId}/schedule`, { date: '2026-11-13' });
    expect(r.json.task).toMatchObject({ scheduledDate: '2026-11-13', startTime: null, durationMinutes: null });
  });

  it('validates times and keeps blocks inside the day', async () => {
    expect((await t.call('PUT', `/api/v1/tasks/${taskId}/schedule`, { date: '2026-11-12', startTime: '25:00' })).status).toBe(400);
    expect((await t.call('PUT', `/api/v1/tasks/${taskId}/schedule`, { date: '2026-11-12', startTime: '23:45', durationMinutes: 30 })).status).toBe(422);
    expect((await t.call('PUT', `/api/v1/tasks/${taskId}/schedule`, { date: '2026-11-12', startTime: '09:00', durationMinutes: 2 })).status).toBe(400);
  });

  it('plan: whole task or new child, both can be timed; unschedule clears the time', async () => {
    const whole = await t.call('POST', `/api/v1/tasks/${taskId}/plan`, { date: '2026-11-12', startTime: '10:00' });
    expect(whole.json.task).toMatchObject({ startTime: '10:00', durationMinutes: 30 });

    const child = await t.call('POST', `/api/v1/tasks/${taskId}/plan`, { date: '2026-11-12', goal: 'Outline', startTime: '11:15', durationMinutes: 45 });
    expect(child.json).toMatchObject({ created: true, task: { title: 'Outline', startTime: '11:15', durationMinutes: 45 } });

    const un = await t.call('DELETE', `/api/v1/tasks/${taskId}/schedule`);
    expect(un.json.task).toMatchObject({ scheduledDate: null, startTime: null, durationMinutes: null });
  });

  it('week view and export carry the time block', async () => {
    await t.call('PUT', `/api/v1/tasks/${taskId}/schedule`, { date: '2026-11-12', startTime: '08:00', durationMinutes: 60 });
    const week = (await t.call('GET', '/api/v1/week')).json;
    expect(week.days[1].tasks[0]).toMatchObject({ startTime: '08:00', durationMinutes: 60 });
    const dump = (await t.call('GET', '/api/v1/export')).json;
    expect(dump.tasks[0]).toMatchObject({ startTime: '08:00', durationMinutes: 60 });
    const t2 = setup();
    expect((await t2.call('POST', '/api/v1/import', dump)).status).toBe(200);
    expect((await t2.call('GET', '/api/v1/tasks')).json.items[0]).toMatchObject({ startTime: '08:00', durationMinutes: 60 });
  });
});

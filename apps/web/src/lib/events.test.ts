import { beforeAll, describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@aeonic/client';
import { eventDates, segmentsFor } from './events';

beforeAll(() => {
  process.env.TZ = 'America/New_York';
});

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e', calendarId: 'c', calendarName: 'Cal', color: 'sky', uid: 'u', title: 'T',
  start: '', end: '', allDay: false, location: null, ...over,
});

describe('segmentsFor', () => {
  it('places a UTC instant on the right local day and minute', () => {
    // 2026-11-12T00:30Z is 19:30 EST on the 11th
    const e = ev({ start: '2026-11-12T00:30:00Z', end: '2026-11-12T01:30:00Z' });
    expect(segmentsFor([e], '2026-11-11')).toMatchObject([{ startMin: 19 * 60 + 30, endMin: 20 * 60 + 30, allDay: false }]);
    expect(segmentsFor([e], '2026-11-12')).toHaveLength(0);
  });
  it('splits an overnight event across both days, clipped to midnight', () => {
    const e = ev({ start: '2026-11-12T03:00:00Z', end: '2026-11-12T12:00:00Z' }); // 22:00 → 07:00 local
    expect(segmentsFor([e], '2026-11-11')[0]).toMatchObject({ startMin: 22 * 60, endMin: 1440 });
    expect(segmentsFor([e], '2026-11-12')[0]).toMatchObject({ startMin: 0, endMin: 7 * 60 });
  });
  it('matches all-day events by date with an exclusive end', () => {
    const e = ev({ allDay: true, start: '2026-11-12', end: '2026-11-14' });
    expect(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map((d) => segmentsFor([e], d).length)).toEqual([0, 1, 1, 0]);
  });
  it('lists all-day first', () => {
    const t = ev({ id: 't', start: '2026-11-12T15:00:00Z', end: '2026-11-12T16:00:00Z' });
    const a = ev({ id: 'a', allDay: true, start: '2026-11-12', end: '2026-11-13' });
    expect(segmentsFor([t, a], '2026-11-12').map((s) => s.event.id)).toEqual(['a', 't']);
  });
});

describe('eventDates', () => {
  it('gives inclusive first/last local dates', () => {
    expect(eventDates(ev({ allDay: true, start: '2026-11-12', end: '2026-11-15' }))).toEqual({ first: '2026-11-12', last: '2026-11-14' });
    expect(eventDates(ev({ start: '2026-11-12T15:00:00Z', end: '2026-11-12T16:00:00Z' }))).toEqual({ first: '2026-11-12', last: '2026-11-12' });
    // ends exactly at local midnight → previous day
    expect(eventDates(ev({ start: '2026-11-12T03:00:00Z', end: '2026-11-13T05:00:00Z' }))).toEqual({ first: '2026-11-11', last: '2026-11-12' });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { describeNow, fmtRemaining, type NowItem, type NowResponse } from './now';

beforeAll(() => {
  process.env.TZ = 'America/New_York';
});

const item = (over: Partial<NowItem>): NowItem => ({
  kind: 'task', id: 'i', title: 'Write', start: '', end: '', projectName: 'P', calendarName: null, calendarColor: null, ...over,
});
const res = (over: Partial<NowResponse>): NowResponse => ({ now: '', current: null, next: null, ...over });
const T = (iso: string) => Date.parse(iso);

describe('fmtRemaining', () => {
  it('formats h:mm and rounds up to the minute', () => {
    expect(fmtRemaining(25 * 60_000)).toBe('0:25');
    expect(fmtRemaining(65 * 60_000)).toBe('1:05');
    expect(fmtRemaining(1_000)).toBe('0:01');
    expect(fmtRemaining(0)).toBe('0:00');
    expect(fmtRemaining(-5_000)).toBe('0:00');
  });
  it('adds days past 24 hours', () => {
    expect(fmtRemaining((27 * 60 + 5) * 60_000)).toBe('1d 3:05');
  });
});

describe('describeNow', () => {
  const now = T('2026-11-11T15:05:00Z'); // 10:05 EST
  it('current task: ends at clock time with time left', () => {
    const l = describeNow(res({ current: item({ start: '2026-11-11T15:00:00Z', end: '2026-11-11T15:30:00Z' }) }), now)!;
    expect(l).toMatchObject({ state: 'Current', noun: 'task', phrase: 'ends at 10:30 AM', remaining: '0:25 left' });
  });
  it('current event uses the noun "event"', () => {
    const l = describeNow(res({ current: item({ kind: 'event', calendarName: 'Work', end: '2026-11-11T16:00:00Z' }) }), now)!;
    expect(l).toMatchObject({ state: 'Current', noun: 'event' });
  });
  it('upcoming: starts at clock time with time away; names the day when not today', () => {
    const today = describeNow(res({ next: item({ start: '2026-11-11T16:10:00Z', end: '2026-11-11T17:00:00Z' }) }), now)!;
    expect(today).toMatchObject({ state: 'Upcoming', phrase: 'starts at 11:10 AM', remaining: '1:05 away' });
    const later = describeNow(res({ next: item({ start: '2026-11-13T14:00:00Z', end: '2026-11-13T15:00:00Z' }) }), now)!;
    expect(later.phrase).toBe('starts at Fri 9:00 AM');
    expect(later.remaining).toBe('1d 22:55 away');
  });
  it('prefers current over next, and is null when nothing is relevant', () => {
    const both = describeNow(
      res({ current: item({ end: '2026-11-11T15:30:00Z' }), next: item({ id: 'n', start: '2026-11-11T16:00:00Z' }) }), now,
    )!;
    expect(both.state).toBe('Current');
    expect(describeNow(res({}), now)).toBeNull();
    expect(describeNow(undefined, now)).toBeNull();
  });
  it('ignores a stale current that has already ended', () => {
    const l = describeNow(res({ current: item({ end: '2026-11-11T15:00:00Z' }), next: item({ id: 'n', start: '2026-11-11T16:00:00Z' }) }), now)!;
    expect(l.state).toBe('Upcoming');
  });
});

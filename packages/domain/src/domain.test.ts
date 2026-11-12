import { describe, expect, it } from 'vitest';
import {
  addDays, computeUrgencies, indexTasks, isUnblocked, isWeekend, matchesFilter,
  sortTasks, weekFrom, wouldCreateCycle, scheduledDependents, type Task,
} from './index';

const mk = (id: string, over: Partial<Task> = {}): Task => ({
  id, projectId: 'p1', parentId: null, title: id, importance: 2,
  hardDue: null, softDue: null, scheduledDate: null, startTime: null, durationMinutes: null, done: false, tags: [], blockedBy: [], ...over,
});
const TODAY = '2026-11-11';

describe('dates', () => {
  it('builds a 7-day week and flags weekends', () => {
    const w = weekFrom('2026-11-11'); // Wed
    expect(w).toHaveLength(7);
    expect(w.filter(isWeekend)).toEqual(['2026-11-14', '2026-11-15']);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('isUnblocked', () => {
  it('unblocks once the blocker is scheduled or done', () => {
    const a = mk('a');
    const b = mk('b', { blockedBy: ['a'] });
    expect(isUnblocked(b, indexTasks([a, b]))).toBe(false);
    const a2 = { ...a, scheduledDate: '2026-11-12' };
    expect(isUnblocked(b, indexTasks([a2, b]))).toBe(true);
    expect(isUnblocked(b, indexTasks([{ ...a, done: true }, b]))).toBe(true);
  });
  it('requires all blockers', () => {
    const a = mk('a', { scheduledDate: TODAY });
    const c = mk('c');
    const b = mk('b', { blockedBy: ['a', 'c'] });
    expect(isUnblocked(b, indexTasks([a, c, b]))).toBe(false);
  });
});

describe('wouldCreateCycle', () => {
  const a = mk('a');
  const b = mk('b', { blockedBy: ['a'] });
  const c = mk('c', { blockedBy: ['b'] });
  it('detects direct, self and transitive cycles', () => {
    expect(wouldCreateCycle([a, b, c], 'a', ['a'])).toBe(true);
    expect(wouldCreateCycle([a, b, c], 'a', ['b'])).toBe(true);
    expect(wouldCreateCycle([a, b, c], 'a', ['c'])).toBe(true);
    expect(wouldCreateCycle([a, b, c], 'c', ['a'])).toBe(false);
  });
});

describe('computeUrgencies', () => {
  it('inherits the soonest due date from downstream dependents', () => {
    const a = mk('a', { softDue: '2026-12-01' });
    const b = mk('b', { blockedBy: ['a'], hardDue: '2026-11-14' });
    const c = mk('c', { blockedBy: ['b'], hardDue: '2026-11-20' });
    const u = computeUrgencies([a, b, c], TODAY);
    expect(u.get('a')).toEqual({ days: 3, kind: 'hard', sourceTaskId: 'b' });
    expect(u.get('b')?.days).toBe(3);
    expect(u.get('c')?.days).toBe(9);
  });
  it('prefers hard on ties, reports overdue as negative, ignores done', () => {
    const a = mk('a', { softDue: '2026-11-12', hardDue: '2026-11-12' });
    const o = mk('o', { hardDue: '2026-11-09' });
    const d = mk('d', { done: true, hardDue: '2026-11-01' });
    const u = computeUrgencies([a, o, d], TODAY);
    expect(u.get('a')?.kind).toBe('hard');
    expect(u.get('o')?.days).toBe(-2);
    expect(u.get('d')).toBeNull();
  });
});

describe('sortTasks', () => {
  const tasks = [
    mk('low-soon', { importance: 1, hardDue: '2026-11-12' }),
    mk('high-late', { importance: 4, softDue: '2026-12-25' }),
    mk('high-none', { importance: 4 }),
  ];
  const u = computeUrgencies(tasks, TODAY);
  it('sorts by importance then urgency', () => {
    expect(sortTasks(tasks, 'importance', u).map((t) => t.id)).toEqual(['high-late', 'high-none', 'low-soon']);
  });
  it('sorts by urgency then importance', () => {
    expect(sortTasks(tasks, 'urgency', u).map((t) => t.id)).toEqual(['low-soon', 'high-late', 'high-none']);
  });
});

describe('matchesFilter', () => {
  const project = { id: 'p1', name: 'P', description: null, importance: 2, archived: false, tags: ['work'] };
  it('matches task or project tags (OR) and ANDs other facets', () => {
    const t = mk('t', { tags: ['home'], importance: 3 });
    expect(matchesFilter(t, project, { tags: ['work', 'x'] })).toBe(true);
    expect(matchesFilter(t, project, { tags: ['x'] })).toBe(false);
    expect(matchesFilter(t, project, { tags: ['home'], importance: [4] })).toBe(false);
    expect(matchesFilter(mk('d', { done: true }), project, {})).toBe(false);
    expect(matchesFilter(mk('d', { done: true }), project, { showDone: true })).toBe(true);
  });
});

describe('scheduledDependents', () => {
  it('returns scheduled downstream tasks', () => {
    const a = mk('a');
    const b = mk('b', { blockedBy: ['a'], scheduledDate: TODAY });
    const c = mk('c', { blockedBy: ['b'] });
    expect(scheduledDependents('a', [a, b, c]).map((t) => t.id)).toEqual(['b']);
  });
});

import { addMonths, mondayIndex, monthGrid, startOfMonth } from './index';

describe('month helpers', () => {
  it('shifts months across year boundaries', () => {
    expect(addMonths('2026-11-11', 1)).toBe('2026-12-01');
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(startOfMonth('2026-11-11')).toBe('2026-11-01');
  });
  it('builds Monday-first grids covering the whole month', () => {
    expect(mondayIndex('2026-11-01')).toBe(6); // Sunday
    const g = monthGrid('2026-11-11');
    expect(g[0]![0]).toBe('2026-10-26');
    expect(g.at(-1)!.at(-1)).toBe('2026-12-06');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat()).toContain('2026-11-30');
    // a month starting on Monday needs no leading days
    expect(monthGrid('2026-06-10')[0]![0]).toBe('2026-06-01');
    expect(monthGrid('2027-02-10')).toHaveLength(4); // Feb 2027 starts Monday, 28 days
    expect(monthGrid('2026-02-10')).toHaveLength(5); // Feb 2026 starts Sunday
  });
});

import { clampBlock, layoutOverlaps, minutesToTime, snapMinutes, timeToMinutes } from './index';

describe('time helpers', () => {
  it('converts and snaps', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(5000)).toBe('23:59');
    expect(snapMinutes(37)).toBe(30);
    expect(snapMinutes(38)).toBe(45);
  });
  it('clamps blocks into the day with a minimum length', () => {
    expect(clampBlock(1430, 60)).toEqual({ start: 1380, duration: 60 });
    expect(clampBlock(-20, 30)).toEqual({ start: 0, duration: 30 });
    expect(clampBlock(600, 3)).toEqual({ start: 600, duration: 15 });
  });
});

describe('layoutOverlaps', () => {
  it('puts overlapping items in separate lanes and reuses freed lanes', () => {
    const p = layoutOverlaps([
      { id: 'a', start: 60, end: 120 },
      { id: 'b', start: 90, end: 150 },
      { id: 'c', start: 120, end: 180 }, // starts when a ends → reuses lane 0, still overlaps b
      { id: 'd', start: 300, end: 330 }, // separate cluster
    ]);
    const by = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(by.a).toMatchObject({ lane: 0, lanes: 2 });
    expect(by.b).toMatchObject({ lane: 1, lanes: 2 });
    expect(by.c).toMatchObject({ lane: 0, lanes: 2 });
    expect(by.d).toMatchObject({ lane: 0, lanes: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  addDays, computeUrgencies, indexTasks, isUnblocked, isWeekend, matchesFilter,
  sortTasks, weekFrom, wouldCreateCycle, scheduledDependents, type Task,
} from './index';

const mk = (id: string, over: Partial<Task> = {}): Task => ({
  id, projectId: 'p1', parentId: null, title: id, importance: 2,
  hardDue: null, softDue: null, scheduledDate: null, done: false, tags: [], blockedBy: [], ...over,
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

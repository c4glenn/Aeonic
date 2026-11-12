import { daysBetween } from './dates';
import { dependentsMap, indexTasks, transitiveDependents } from './deps';
import type { Task, Urgency } from './types';

/**
 * Urgency of a task = soonest due date (hard or soft) among the task and every
 * not-done transitive dependent. Hard wins ties. Negative days = overdue.
 */
export function computeUrgencies(tasks: readonly Task[], today: string): Map<string, Urgency | null> {
  const byId = indexTasks(tasks);
  const dependents = dependentsMap(tasks);
  const result = new Map<string, Urgency | null>();

  for (const task of tasks) {
    if (task.done) {
      result.set(task.id, null);
      continue;
    }
    const ids = [task.id, ...transitiveDependents(task.id, dependents)];
    let best: Urgency | null = null;
    for (const id of ids) {
      const t = byId.get(id);
      if (!t || t.done) continue;
      for (const [kind, date] of [
        ['hard', t.hardDue],
        ['soft', t.softDue],
      ] as const) {
        if (!date) continue;
        const days = daysBetween(today, date);
        if (!best || days < best.days || (days === best.days && kind === 'hard' && best.kind === 'soft')) {
          best = { days, kind, sourceTaskId: t.id };
        }
      }
    }
    result.set(task.id, best);
  }
  return result;
}

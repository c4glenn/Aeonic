import type { Task, Urgency } from './types';

export type SortKey = 'importance' | 'urgency';

function urgencyRank(u: Urgency | null | undefined): number {
  if (!u) return Number.POSITIVE_INFINITY;
  // hard sorts just before soft on the same day
  return u.days * 2 + (u.kind === 'hard' ? 0 : 1);
}

/** Stable sort. importance: high→low then urgency. urgency: soonest→latest then importance. */
export function sortTasks<T extends Task>(
  tasks: readonly T[],
  by: SortKey,
  urgencies: ReadonlyMap<string, Urgency | null>,
): T[] {
  const cmpImportance = (a: T, b: T) => b.importance - a.importance;
  const cmpUrgency = (a: T, b: T) => {
    const ua = urgencyRank(urgencies.get(a.id));
    const ub = urgencyRank(urgencies.get(b.id));
    if (ua === ub) return 0;
    return ua < ub ? -1 : 1;
  };
  const [first, second] = by === 'importance' ? [cmpImportance, cmpUrgency] : [cmpUrgency, cmpImportance];
  return [...tasks].sort((a, b) => first(a, b) || second(a, b) || a.title.localeCompare(b.title));
}

import type { Task } from './types';

export function indexTasks(tasks: readonly Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** Map of taskId -> ids of tasks that list it in blockedBy. */
export function dependentsMap(tasks: readonly Task[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of tasks) {
    for (const b of t.blockedBy) {
      const list = map.get(b);
      if (list) list.push(t.id);
      else map.set(b, [t.id]);
    }
  }
  return map;
}

/** A task is unblocked when every blocker is scheduled or done. Missing blockers are ignored. */
export function isUnblocked(task: Task, byId: ReadonlyMap<string, Task>): boolean {
  return task.blockedBy.every((id) => {
    const b = byId.get(id);
    return !b || b.done || b.scheduledDate !== null;
  });
}

/** Blockers that still prevent scheduling `task`. */
export function activeBlockers(task: Task, byId: ReadonlyMap<string, Task>): Task[] {
  return task.blockedBy
    .map((id) => byId.get(id))
    .filter((b): b is Task => !!b && !b.done && b.scheduledDate === null);
}

/** All transitive dependents of `taskId` (excluding itself). */
export function transitiveDependents(
  taskId: string,
  dependents: ReadonlyMap<string, string[]>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...(dependents.get(taskId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(dependents.get(id) ?? []));
  }
  return seen;
}

/** Would giving `taskId` the blockers `newBlockedBy` create a cycle? */
export function wouldCreateCycle(
  tasks: readonly Task[],
  taskId: string,
  newBlockedBy: readonly string[],
): boolean {
  const downstream = transitiveDependents(taskId, dependentsMap(tasks));
  return newBlockedBy.some((b) => b === taskId || downstream.has(b));
}

/** Dependents already scheduled earlier than their (now unscheduled) blocker would allow. */
export function scheduledDependents(
  taskId: string,
  tasks: readonly Task[],
): Task[] {
  const byId = indexTasks(tasks);
  const ids = transitiveDependents(taskId, dependentsMap(tasks));
  return [...ids].map((id) => byId.get(id)!).filter((t) => t.scheduledDate !== null && !t.done);
}

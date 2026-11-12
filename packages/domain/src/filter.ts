import type { Project, Task } from './types';

export interface TaskFilter {
  /** Match if the task (or its project) has ANY of these tags. */
  tags?: string[];
  importance?: number[];
  projectIds?: string[];
  showDone?: boolean;
}

export function matchesFilter(task: Task, project: Project | undefined, f: TaskFilter): boolean {
  if (!f.showDone && task.done) return false;
  if (f.projectIds?.length && !f.projectIds.includes(task.projectId)) return false;
  if (f.importance?.length && !f.importance.includes(task.importance)) return false;
  if (f.tags?.length) {
    const all = new Set([...task.tags, ...(project?.tags ?? [])]);
    if (!f.tags.some((t) => all.has(t))) return false;
  }
  return true;
}

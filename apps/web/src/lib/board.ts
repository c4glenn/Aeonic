import { useMemo } from 'react';
import {
  computeUrgencies,
  indexTasks,
  isUnblocked,
  matchesFilter,
  sortTasks,
  todayIn,
  weekFrom,
  type Urgency,
} from '@aeonic/domain';
import type { Project, Task } from '@aeonic/client';
import { useProjectsQuery, useTasksQuery } from './api';
import type { ViewState } from './view-state';

/**
 * Derived board state. Rules (unblocked, urgency, filter, sort) come from @aeonic/domain — the same
 * code the server uses — so optimistic updates unlock dependents instantly and never disagree.
 */
export interface Board {
  loading: boolean;
  today: string;
  days: string[];
  projects: Project[];
  projectById: Map<string, Project>;
  taskById: Map<string, Task>;
  urgencies: Map<string, Urgency | null>;
  unblocked: (t: Task) => boolean;
  /** Tasks passing the current filter, sorted. */
  visible: Task[];
  scheduledOn: (date: string) => Task[];
  dueOn: (date: string) => { task: Task; kind: 'hard' | 'soft' }[];
  blockerTitles: (t: Task) => string[];
}

export function useBoard(view: ViewState): Board {
  const tasksQ = useTasksQuery();
  const projectsQ = useProjectsQuery();
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

  return useMemo(() => {
    const tasks = tasksQ.data ?? [];
    const projects = projectsQ.data ?? [];
    const taskById = indexTasks(tasks) as Map<string, Task>;
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const urgencies = computeUrgencies(tasks, today);
    const unblockedMemo = new Map(tasks.map((t) => [t.id, isUnblocked(t, taskById)]));
    const filtered = tasks.filter((t) => {
      const project = projectById.get(t.projectId);
      if (!project || project.archived) return false;
      if (view.tags.length || view.importance.length || view.projects.length || !view.showDone) {
        return matchesFilter(t, project, {
          tags: view.tags,
          importance: view.importance,
          projectIds: view.projects,
          showDone: view.showDone,
        });
      }
      return true;
    });
    const visible = sortTasks(filtered, view.sort, urgencies);
    const days = weekFrom(today);
    return {
      loading: tasksQ.isLoading || projectsQ.isLoading,
      today,
      days,
      projects,
      projectById,
      taskById,
      urgencies,
      unblocked: (t) => unblockedMemo.get(t.id) ?? true,
      visible,
      scheduledOn: (date) => visible.filter((t) => t.scheduledDate === date && !t.done),
      dueOn: (date) =>
        visible
          .filter((t) => !t.done)
          .flatMap((t) => [
            ...(t.hardDue === date ? [{ task: t, kind: 'hard' as const }] : []),
            ...(t.softDue === date ? [{ task: t, kind: 'soft' as const }] : []),
          ]),
      blockerTitles: (t) =>
        t.blockedBy
          .map((id) => taskById.get(id))
          .filter((b): b is Task => !!b && !b.done && !b.scheduledDate)
          .map((b) => b.title),
    };
  }, [tasksQ.data, projectsQ.data, tasksQ.isLoading, projectsQ.isLoading, today, view]);
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, unwrap, type Project, type Task } from '@aeonic/client';
import { api, qk } from './api';

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.tasks });
    void qc.invalidateQueries({ queryKey: qk.projects });
    void qc.invalidateQueries({ queryKey: qk.tags });
  };
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    const blockers = (e.problem.blockers as { title: string }[] | undefined)?.map((b) => b.title).join(', ');
    return blockers ? `Blocked by: ${blockers}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** Optimistic helper: patch the cached tasks, roll back on failure, always resync. */
function useOptimisticTasks() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return {
    apply: async (fn: (tasks: Task[]) => Task[]) => {
      await qc.cancelQueries({ queryKey: qk.tasks });
      const prev = qc.getQueryData<Task[]>(qk.tasks);
      if (prev) qc.setQueryData(qk.tasks, fn(prev));
      return prev;
    },
    rollback: (prev: Task[] | undefined) => prev && qc.setQueryData(qk.tasks, prev),
    settle: invalidate,
  };
}

export interface ScheduleArgs {
  id: string;
  date: string;
  /** HH:MM; omit for an untimed task. */
  startTime?: string | null;
  /** Minutes; defaults to 30 when startTime is given. */
  durationMinutes?: number | null;
}

export function useScheduleTask() {
  const o = useOptimisticTasks();
  return useMutation({
    mutationFn: ({ id, date, startTime, durationMinutes }: ScheduleArgs) =>
      unwrap(api.PUT('/api/v1/tasks/{id}/schedule', { params: { path: { id } }, body: { date, startTime, durationMinutes } })),
    onMutate: ({ id, date, startTime, durationMinutes }) =>
      o.apply((ts) =>
        ts.map((t) =>
          t.id === id
            ? { ...t, scheduledDate: date, startTime: startTime ?? null, durationMinutes: startTime ? (durationMinutes ?? 30) : null }
            : t,
        ),
      ),
    onError: (e, _v, prev) => {
      o.rollback(prev);
      toast.error(describe(e));
    },
    onSettled: o.settle,
  });
}

export function useUnscheduleTask() {
  const o = useOptimisticTasks();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/tasks/{id}/schedule', { params: { path: { id } } })),
    onMutate: (id) => o.apply((ts) => ts.map((t) => (t.id === id ? { ...t, scheduledDate: null, startTime: null, durationMinutes: null } : t))),
    onSuccess: (r) => {
      if (r.scheduledDependents.length) {
        toast.warning(`${r.scheduledDependents.length} dependent task(s) are still scheduled`, {
          description: r.scheduledDependents.map((t) => t.title).join(', '),
        });
      }
    },
    onError: (e, _v, prev) => {
      o.rollback(prev);
      toast.error(describe(e));
    },
    onSettled: o.settle,
  });
}

export function usePlanTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, date, goal, startTime, durationMinutes }: ScheduleArgs & { goal?: string }) =>
      unwrap(api.POST('/api/v1/tasks/{id}/plan', { params: { path: { id } }, body: { date, goal, startTime, durationMinutes } })),
    onError: (e) => toast.error(describe(e)),
    onSettled: invalidate,
  });
}

export function useUpdateTask() {
  const o = useOptimisticTasks();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) =>
      unwrap(
        api.PATCH('/api/v1/tasks/{id}', {
          params: { path: { id } },
          body: patch as never,
        }),
      ),
    onMutate: ({ id, patch }) => o.apply((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    onError: (e, _v, prev) => {
      o.rollback(prev);
      toast.error(describe(e));
    },
    onSettled: o.settle,
  });
}

export function useCreateTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: {
      projectId: string; title: string; importance?: number; hardDue?: string | null;
      softDue?: string | null; tags?: string[]; blockedBy?: string[];
    }) => unwrap(api.POST('/api/v1/tasks', { body })),
    onError: (e) => toast.error(describe(e)),
    onSettled: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/tasks/{id}', { params: { path: { id } } })),
    onError: (e) => toast.error(describe(e)),
    onSettled: invalidate,
  });
}

export function useSetDependencies() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, blockedBy }: { id: string; blockedBy: string[] }) =>
      unwrap(api.PUT('/api/v1/tasks/{id}/dependencies', { params: { path: { id } }, body: { blockedBy } })),
    onError: (e) => toast.error(describe(e)),
    onSettled: invalidate,
  });
}

export function useCreateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; importance?: number; tags?: string[] }) =>
      unwrap(api.POST('/api/v1/projects', { body })),
    onError: (e) => toast.error(describe(e)),
    onSettled: invalidate,
  });
}

export function useUpdateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Project> }) =>
      unwrap(api.PATCH('/api/v1/projects/{id}', { params: { path: { id } }, body: patch as never })),
    onError: (e) => toast.error(describe(e)),
    onSettled: invalidate,
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/projects/{id}', { params: { path: { id } } })),
    onError: (e) => toast.error(describe(e)),
    onSettled: invalidate,
  });
}

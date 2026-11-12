import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, CalendarDays, ChartGantt, ListTodo, Settings as SettingsIcon } from 'lucide-react';
import { ApiError, unwrap, type Project, type Task } from '@todo/client';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Login } from '@/features/auth/Login';
import { PlanDialog, type PlanTarget } from '@/features/forms/PlanDialog';
import { ProjectDialog, type ProjectDialogState } from '@/features/forms/ProjectDialog';
import { TaskDialog, type TaskDialogState } from '@/features/forms/TaskDialog';
import { ProjectCard } from '@/features/projects/ProjectCard';
import { Settings } from '@/features/settings/Settings';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { WeekStrip } from '@/features/week/WeekStrip';
import { GanttView } from '@/features/views/GanttView';
import { ListView } from '@/features/views/ListView';
import { MonthView } from '@/features/views/MonthView';
import { api, useLiveSync } from '@/lib/api';
import { useBoard } from '@/lib/board';
import { usePlanTask, useScheduleTask, useUnscheduleTask, useUpdateTask } from '@/lib/mutations';
import { useViewState } from '@/lib/view-state';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Drop where the pointer is (chips are wide); fall back to rect overlap for keyboard dragging. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

function useHash() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash,
  );
}

export function App() {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    retry: false,
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET('/api/v1/tags')),
  });
  const unauthorized = session.error instanceof ApiError && session.error.status === 401;
  useLiveSync(session.isSuccess);

  if (session.isLoading) return <div className="grid min-h-dvh place-items-center text-muted-foreground">Loading…</div>;
  if (unauthorized) {
    return (
      <>
        <Login onDone={() => void qc.invalidateQueries()} />
        <Toaster />
      </>
    );
  }
  if (session.isError) {
    return <div className="grid min-h-dvh place-items-center text-muted-foreground">Can’t reach the server.</div>;
  }
  return <Shell onSignOut={() => void qc.resetQueries()} />;
}

type Mode = 'week' | 'list' | 'month' | 'gantt';
const NAV: { hash: string; mode: Mode | 'settings'; label: string; icon: typeof Calendar }[] = [
  { hash: '#/', mode: 'week', label: 'Week', icon: CalendarDays },
  { hash: '#/list', mode: 'list', label: 'List', icon: ListTodo },
  { hash: '#/month', mode: 'month', label: 'Month', icon: Calendar },
  { hash: '#/gantt', mode: 'gantt', label: 'Gantt', icon: ChartGantt },
  { hash: '#/settings', mode: 'settings', label: 'Settings', icon: SettingsIcon },
];

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const hash = useHash();
  const current = NAV.find((n) => n.hash === hash)?.mode ?? 'week';
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1500px] flex-col gap-3 px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-2">
        <a href="#/" className="font-display text-xl font-bold tracking-tight max-sm:sr-only">
          <span className="text-primary">▮▮</span> Todo Tool
        </a>
        <nav className="flex gap-1 max-sm:w-full max-sm:justify-between" aria-label="Views">
          {NAV.map(({ hash: h, mode, label, icon: Icon }) => (
            <Button key={mode} variant={current === mode ? 'secondary' : 'ghost'} className="h-10 max-sm:flex-1 max-sm:flex-col max-sm:gap-0 max-sm:text-[11px]" asChild>
              <a href={h} aria-current={current === mode ? 'page' : undefined}>
                <Icon className="size-4" /> {label}
              </a>
            </Button>
          ))}
        </nav>
      </header>
      {current === 'settings' ? <Settings onSignOut={onSignOut} /> : <BoardView mode={current} />}
      <Toaster />
    </div>
  );
}

function BoardView({ mode }: { mode: Mode }) {
  const [view, setView] = useViewState();
  const board = useBoard(view);
  const [plan, setPlan] = useState<PlanTarget | null>(null);
  const [taskDialog, setTaskDialog] = useState<TaskDialogState>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>(null);
  const [dragging, setDragging] = useState<Task | null>(null);

  const schedule = useScheduleTask();
  const unschedule = useUnscheduleTask();
  const planTask = usePlanTask();
  const update = useUpdateTask();

  // Long-press on touch so vertical scrolling still works; keyboard sensor for accessibility.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const place = (task: Task, date: string) => {
    if (task.scheduledDate === date) return;
    if (task.scheduledDate) schedule.mutate({ id: task.id, date }); // already scheduled: just move it
    else setPlan({ task, date }); // otherwise ask what they're planning to do
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const task = e.active.data.current?.task as Task | undefined;
    const over = e.over ? String(e.over.id) : null;
    if (task && over && DATE_RE.test(over)) place(task, over);
  };
  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.task as Task) ?? null);

  const handlers = {
    onOpen: (t: Task) => setTaskDialog({ mode: 'edit', task: t }),
    onPick: place,
    onToggleDone: (t: Task) => update.mutate({ id: t.id, patch: { done: !t.done } }),
    onUnschedule: (t: Task) => unschedule.mutate(t.id),
  };

  const filtering = !!(view.tags.length || view.importance.length || view.projects.length);
  const tasksByProject = new Map<string, Task[]>();
  for (const t of board.visible) tasksByProject.set(t.projectId, [...(tasksByProject.get(t.projectId) ?? []), t]);
  const projects = board.projects.filter((p) => !filtering || tasksByProject.has(p.id));

  // Ensure edit dialog reflects live data after refetch.
  useEffect(() => {
    setTaskDialog((s) => (s?.mode === 'edit' && board.taskById.has(s.task.id) ? { mode: 'edit', task: board.taskById.get(s.task.id)! } : s));
  }, [board.taskById]);

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <Toolbar view={view} setView={setView} board={board} onAddProject={() => setProjectDialog({ mode: 'create' })}
        onAddTask={() => board.projects[0] && setTaskDialog({ mode: 'create', projectId: view.projects[0] ?? board.projects[0].id })}
      />

      {mode === 'week' && (
        <>
          <div className="z-20 -mx-4 bg-background px-4 pb-1 pt-1 max-sm:sticky max-sm:top-0 max-sm:max-h-[50dvh] max-sm:overflow-y-auto">
            <WeekStrip board={board} {...handlers} />
          </div>

          {board.loading ? (
            <p className="py-10 text-center text-muted-foreground">Loading…</p>
          ) : board.projects.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="mb-3 text-muted-foreground">No projects yet.</p>
              <Button onClick={() => setProjectDialog({ mode: 'create' })}>Create your first project</Button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p: Project) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  board={board}
                  tasks={tasksByProject.get(p.id) ?? []}
                  onAddTask={(projectId) => setTaskDialog({ mode: 'create', projectId })}
                  onEdit={(project) => setProjectDialog({ mode: 'edit', project })}
                  {...handlers}
                />
              ))}
            </div>
          )}
        </>
      )}
      {mode === 'list' && <ListView board={board} sort={view.sort} {...handlers} />}
      {mode === 'month' && <MonthView board={board} {...handlers} />}
      {mode === 'gantt' && <GanttView board={board} onOpen={handlers.onOpen} />}

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="max-w-64 rounded-md border-2 border-primary bg-popover px-3 py-2 text-sm shadow-lg">{dragging.title}</div>
        )}
      </DragOverlay>

      <PlanDialog
        target={plan}
        onClose={() => setPlan(null)}
        onWhole={(t) => {
          schedule.mutate({ id: t.task.id, date: t.date });
          setPlan(null);
        }}
        onGoal={(t, goal) => {
          planTask.mutate({ id: t.task.id, date: t.date, goal });
          setPlan(null);
        }}
      />
      <TaskDialog state={taskDialog} board={board} onClose={() => setTaskDialog(null)} />
      <ProjectDialog state={projectDialog} onClose={() => setProjectDialog(null)} />
    </DndContext>
  );
}

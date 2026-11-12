import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, CalendarDays, ChartGantt, ListTodo, Settings as SettingsIcon } from 'lucide-react';
import { clampBlock, DEFAULT_DURATION, minutesToTime } from '@aeonic/domain';
import { ApiError, unwrap, type Project, type Task } from '@aeonic/client';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Login } from '@/features/auth/Login';
import { PlanDialog, type PlanTarget } from '@/features/forms/PlanDialog';
import { ProjectDialog, type ProjectDialogState } from '@/features/forms/ProjectDialog';
import { TaskDialog, type TaskDialogState } from '@/features/forms/TaskDialog';
import { ProjectCard } from '@/features/projects/ProjectCard';
import { Settings } from '@/features/settings/Settings';
import { NowBanner } from '@/features/now/NowBanner';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { WeekStrip } from '@/features/week/WeekStrip';
import type { Ghost } from '@/features/week/TimeGrid';
import { PX_PER_MIN } from '@/features/week/time-constants';
import { GanttView } from '@/features/views/GanttView';
import { ListView } from '@/features/views/ListView';
import { MonthView } from '@/features/views/MonthView';
import { api, useCalendarEvents, useLiveSync } from '@/lib/api';
import { useBoard } from '@/lib/board';
import { usePlanTask, useScheduleTask, useUnscheduleTask, useUpdateTask } from '@/lib/mutations';
import { useViewState } from '@/lib/view-state';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Drop where the pointer is (chips are wide); fall back to rect overlap for keyboard dragging. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

function pointerY(evt: Event | null): number | null {
  if (!evt) return null;
  if ('clientY' in evt) return (evt as MouseEvent).clientY;
  if ('touches' in evt) {
    const t = evt as TouchEvent;
    return (t.touches[0] ?? t.changedTouches[0])?.clientY ?? null;
  }
  return null;
}

interface TimeDrop extends Ghost {
  task: Task;
}

/**
 * Where on the hour grid is the pointer? Uses the live pointer position (not dnd-kit's delta, which also
 * includes auto-scroll compensation) against the column's current rect, so scrolling mid-drag stays correct.
 */
function timeDrop(e: DragMoveEvent | DragEndEvent, pointer: number | null, grab: number): TimeDrop | null {
  const over = e.over ? String(e.over.id) : '';
  const task = e.active.data.current?.task as Task | undefined;
  if (!task || !over.startsWith('time:') || pointer === null) return null; // null pointer = keyboard drag
  const date = over.slice(5);
  const col = document.querySelector(`[data-timecol="${date}"]`);
  if (!col) return null;
  const raw = (pointer - grab - col.getBoundingClientRect().top) / PX_PER_MIN;
  const duration = task.startTime && task.durationMinutes ? task.durationMinutes : DEFAULT_DURATION;
  return { task, date, duration, startMin: clampBlock(raw, duration).start };
}

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
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <a href="#/" className="shrink-0 font-display text-xl font-bold tracking-tight max-sm:sr-only">
          <span className="text-primary">▮▮</span> Aeonic
        </a>
        {/* desktop: logo | banner | nav on one line; small screens: nav on top, banner below */}
        <NowBanner className="order-last w-full lg:order-none lg:w-auto lg:flex-1" />
        <nav className="flex gap-1 max-sm:w-full max-sm:justify-between lg:ml-auto" aria-label="Views">
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
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const grabRef = useRef(0);
  const track = useRef((ev: Event) => {
    const t = ev as TouchEvent;
    const p = 'touches' in ev ? (t.touches[0] ?? t.changedTouches[0]) : (ev as PointerEvent);
    if (p) pointerRef.current = { x: p.clientX, y: p.clientY };
  }).current;
  const stopTracking = () => {
    window.removeEventListener('pointermove', track);
    window.removeEventListener('touchmove', track);
    pointerRef.current = null;
  };
  useEffect(() => stopTracking, []); // eslint-disable-line react-hooks/exhaustive-deps
  const weekEvents = useCalendarEvents(board.days[0]!, board.days[6]!, mode === 'week');

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

  /** startMin set = dropped on the hour grid (timed block); otherwise an untimed day. */
  /** The hour grid should only auto-scroll when the pointer is inside it (otherwise dragging in from a card below scrolls it away). */
  const canScroll = (el: Element) => {
    if (!(el instanceof HTMLElement) || el.dataset.autoscroll !== 'pointer') return true;
    const p = pointerRef.current;
    if (!p) return false;
    const r = el.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  };

  const place = (task: Task, date: string, startMin?: number) => {
    if (startMin !== undefined) {
      const startTime = minutesToTime(startMin);
      const durationMinutes = task.startTime && task.durationMinutes ? task.durationMinutes : DEFAULT_DURATION;
      if (task.scheduledDate === date && task.startTime === startTime) return;
      if (task.scheduledDate) schedule.mutate({ id: task.id, date, startTime, durationMinutes }); // moving an existing task
      else setPlan({ task, date, startTime });
      return;
    }
    if (task.scheduledDate === date && !task.startTime) return;
    if (task.scheduledDate) schedule.mutate({ id: task.id, date }); // already scheduled: just move it (drops any time)
    else setPlan({ task, date }); // otherwise ask what they're planning to do
  };

  const onDragMove = (e: DragMoveEvent) => {
    const d = timeDrop(e, pointerRef.current?.y ?? null, grabRef.current);
    setGhost((g) => (d ? (g && g.date === d.date && g.startMin === d.startMin && g.duration === d.duration ? g : { date: d.date, startMin: d.startMin, duration: d.duration }) : g ? null : g));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const t = timeDrop(e, pointerRef.current?.y ?? null, grabRef.current);
    stopTracking();
    setDragging(null);
    setGhost(null);
    const task = e.active.data.current?.task as Task | undefined;
    const over = e.over ? String(e.over.id) : null;
    if (!task || !over) return;
    if (t) place(task, t.date, t.startMin);
    else if (over.startsWith('time:')) place(task, over.slice(5));
    else if (DATE_RE.test(over)) place(task, over);
  };
  const onDragStart = (e: DragStartEvent) => {
    const task = (e.active.data.current?.task as Task) ?? null;
    setDragging(task);
    const y = pointerY(e.activatorEvent);
    pointerRef.current = y === null ? null : { x: 0, y };
    // moving an existing block: keep the grab point under the cursor instead of snapping its top to it
    const block = task?.startTime ? document.querySelector(`[data-block="${task.id}"]`) : null;
    grabRef.current = block && y !== null ? y - block.getBoundingClientRect().top : 0;
    if (y !== null) {
      window.addEventListener('pointermove', track);
      window.addEventListener('touchmove', track, { passive: true });
    }
  };

  const handlers = {
    onOpen: (t: Task) => setTaskDialog({ mode: 'edit', task: t }),
    onPick: place,
    onToggleDone: (t: Task) => update.mutate({ id: t.id, patch: { done: !t.done } }),
    onUnschedule: (t: Task) => unschedule.mutate(t.id),
  };
  const onResize = (t: Task, durationMinutes: number) =>
    t.scheduledDate && t.startTime && schedule.mutate({ id: t.id, date: t.scheduledDate, startTime: t.startTime, durationMinutes });

  const filtering = !!(view.tags.length || view.importance.length || view.projects.length);
  const tasksByProject = new Map<string, Task[]>();
  for (const t of board.visible) tasksByProject.set(t.projectId, [...(tasksByProject.get(t.projectId) ?? []), t]);
  const projects = board.projects.filter((p) => !filtering || tasksByProject.has(p.id));

  // Ensure edit dialog reflects live data after refetch.
  useEffect(() => {
    setTaskDialog((s) => {
      if (s?.mode !== 'edit') return s;
      const fresh = board.taskById.get(s.task.id);
      return fresh && fresh !== s.task ? { mode: 'edit', task: fresh } : s; // no-op when unchanged, or it would loop
    });
  }, [board.taskById]);

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => { stopTracking(); setDragging(null); setGhost(null); }} autoScroll={{ canScroll }}>
      <Toolbar view={view} setView={setView} board={board} onAddProject={() => setProjectDialog({ mode: 'create' })}
        onAddTask={() => board.projects[0] && setTaskDialog({ mode: 'create', projectId: view.projects[0] ?? board.projects[0].id })}
      />

      {mode === 'week' && (
        <>
          <WeekStrip board={board} events={weekEvents} ghost={ghost} onResize={onResize} {...handlers} />

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
          schedule.mutate({ id: t.task.id, date: t.date, startTime: t.startTime, durationMinutes: t.startTime ? DEFAULT_DURATION : undefined });
          setPlan(null);
        }}
        onGoal={(t, goal) => {
          planTask.mutate({ id: t.task.id, date: t.date, goal, startTime: t.startTime, durationMinutes: t.startTime ? DEFAULT_DURATION : undefined });
          setPlan(null);
        }}
      />
      <TaskDialog state={taskDialog} board={board} onClose={() => setTaskDialog(null)} />
      <ProjectDialog state={projectDialog} onClose={() => setProjectDialog(null)} />
    </DndContext>
  );
}

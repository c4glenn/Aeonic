import { useDroppable } from '@dnd-kit/core';
import { isWeekend } from '@todo/domain';
import type { CalendarEvent, Task } from '@todo/client';
import { DueMark } from '@/components/marks';
import { EventTag } from '@/components/event-marks';
import type { Board } from '@/lib/board';
import { segmentsFor } from '@/lib/events';
import { cn } from '@/lib/utils';
import { TaskChip } from './TaskChip';
import { TimeGrid, type Ghost } from './TimeGrid';
import { GRID_COLS } from './time-constants';

interface Handlers {
  onOpen: (t: Task) => void;
  onPick: (t: Task, date: string) => void;
  onToggleDone: (t: Task) => void;
  onUnschedule: (t: Task) => void;
}

/** The top of each day: untimed tasks, due markers and all-day events. Dropping here schedules without a time. */
function DayColumn({ date, board, events, ...h }: { date: string; board: Board; events: CalendarEvent[] } & Handlers) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const weekend = isWeekend(date);
  const isToday = date === board.today;
  const d = new Date(date + 'T00:00:00Z');
  const untimed = board.scheduledOn(date).filter((t) => !t.startTime);
  const due = board.dueOn(date);
  const allDay = segmentsFor(events, date).filter((s) => s.allDay);

  return (
    <section
      ref={setNodeRef}
      data-date={date}
      aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
      className={cn(
        'flex min-h-32 min-w-0 flex-col rounded-lg border p-2 transition-colors',
        weekend ? 'weekend-surface border-weekend-line/40' : 'bg-card',
        isToday && 'ring-2 ring-primary',
        isOver && 'border-primary bg-accent/60 ring-2 ring-primary',
      )}
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className={cn('text-sm font-semibold', weekend && 'font-normal uppercase italic tracking-widest text-oi-sky')}>
          {d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}
          <span className="ml-1.5 text-lg tabular-nums">{d.getUTCDate()}</span>
        </h3>
        {isToday && <span className="rounded-sm bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground">Today</span>}
        {weekend && !isToday && <span className="hidden text-[11px] text-oi-sky xl:inline">Weekend</span>}
      </header>

      <ul className="flex flex-1 flex-col gap-1.5">
        {allDay.map((s) => (
          <li key={s.event.id}>
            <EventTag event={s.event} />
          </li>
        ))}
        {due.map(({ task, kind }) => (
          <li key={`${task.id}-${kind}`} className={cn('rounded-md bg-background/60 px-2 py-1 text-xs', kind === 'hard' ? 'due-hard' : 'due-soft')}>
            <DueMark kind={kind} date={date} className="mb-0.5 border-0 px-0" />
            <div className="break-words">{task.title}</div>
          </li>
        ))}
        {untimed.map((t) => (
          <li key={t.id}>
            <TaskChip
              task={t}
              scheduled
              urgency={board.urgencies.get(t.id)}
              days={board.days}
              today={board.today}
              projectName={board.projectById.get(t.projectId)?.name}
              {...h}
            />
          </li>
        ))}
        {!untimed.length && !due.length && !allDay.length && (
          <li className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground/70">Drop a task here</li>
        )}
      </ul>
    </section>
  );
}

export function WeekStrip({
  board, events, ghost, onResize, ...h
}: { board: Board; events: CalendarEvent[]; ghost: Ghost | null; onResize: (t: Task, durationMinutes: number) => void } & Handlers) {
  return (
    <div className="overflow-x-auto pb-1" data-testid="week-planner">
      <div className="flex min-w-[1000px] flex-col gap-2 lg:min-w-0">
        <div className="grid gap-2" style={{ gridTemplateColumns: GRID_COLS }}>
          <div aria-hidden />
          {board.days.map((date) => (
            <DayColumn key={date} date={date} board={board} events={events} {...h} />
          ))}
        </div>
        <TimeGrid board={board} events={events} ghost={ghost} onOpen={h.onOpen} onResize={onResize} />
      </div>
    </div>
  );
}

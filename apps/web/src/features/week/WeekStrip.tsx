import { useDroppable } from '@dnd-kit/core';
import { isWeekend } from '@todo/domain';
import type { Task } from '@todo/client';
import { DueMark } from '@/components/marks';
import type { Board } from '@/lib/board';
import { cn } from '@/lib/utils';
import { TaskChip } from './TaskChip';

interface Handlers {
  onOpen: (t: Task) => void;
  onPick: (t: Task, date: string) => void;
  onToggleDone: (t: Task) => void;
  onUnschedule: (t: Task) => void;
}

function DayColumn({ date, board, ...h }: { date: string; board: Board } & Handlers) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const weekend = isWeekend(date);
  const isToday = date === board.today;
  const d = new Date(date + 'T00:00:00Z');
  const scheduled = board.scheduledOn(date);
  const due = board.dueOn(date);

  return (
    <section
      ref={setNodeRef}
      data-date={date}
      aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
      className={cn(
        'flex min-h-40 shrink-0 snap-start sm:shrink flex-col rounded-lg border p-2 transition-colors sm:min-w-0',
        weekend ? 'weekend-surface border-weekend-line/40' : 'bg-card',
        isToday && 'ring-2 ring-primary',
        isOver && 'border-primary bg-accent/60 ring-2 ring-primary',
      )}
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3
          className={cn(
            'text-sm font-semibold',
            weekend && 'font-normal uppercase italic tracking-widest text-oi-sky',
          )}
        >
          {d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}
          <span className="ml-1.5 text-lg tabular-nums">{d.getUTCDate()}</span>
        </h3>
        {isToday && (
          <span className="rounded-sm bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground">Today</span>
        )}
        {weekend && !isToday && <span className="text-[11px] text-oi-sky">Weekend</span>}
      </header>

      <ul className="flex flex-1 flex-col gap-1.5">
        {due.map(({ task, kind }) => (
          <li
            key={`${task.id}-${kind}`}
            className={cn('rounded-md bg-background/60 px-2 py-1 text-xs', kind === 'hard' ? 'due-hard' : 'due-soft')}
          >
            <DueMark kind={kind} date={date} className="mb-0.5 border-0 px-0" />
            <div className="break-words">{task.title}</div>
          </li>
        ))}
        {scheduled.map((t) => (
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
        {!scheduled.length && !due.length && (
          <li className="flex flex-1 items-center justify-center text-xs text-muted-foreground/70">Drop a task here</li>
        )}
      </ul>
    </section>
  );
}

export function WeekStrip({ board, ...h }: { board: Board } & Handlers) {
  return (
    <div className="grid snap-x snap-mandatory auto-cols-[64%] grid-flow-col gap-2 overflow-x-auto pb-1 sm:grid-flow-row sm:grid-cols-7 sm:overflow-visible">
      {board.days.map((date) => (
        <DayColumn key={date} date={date} board={board} {...h} />
      ))}
    </div>
  );
}

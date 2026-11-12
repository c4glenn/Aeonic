import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, Flag, Hourglass } from 'lucide-react';
import { addMonths, isWeekend, monthGrid, startOfMonth } from '@aeonic/domain';
import type { CalendarEvent, Task } from '@aeonic/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DueMark } from '@/components/marks';
import { EventTag } from '@/components/event-marks';
import { segmentsFor } from '@/lib/events';
import { useCalendarEvents } from '@/lib/api';
import { TaskChip } from '@/features/week/TaskChip';
import type { Board } from '@/lib/board';
import { fmtLong, fmtMonth, weekdayShort } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { MiniChip } from './MiniChip';

interface Handlers {
  onOpen: (t: Task) => void;
  onPick: (t: Task, date: string) => void;
  onToggleDone: (t: Task) => void;
  onUnschedule: (t: Task) => void;
}

const MAX_ITEMS = 3;

function DayCell({
  date, inMonth, board, events, onMore, onOpen,
}: { date: string; inMonth: boolean; board: Board; events: CalendarEvent[]; onMore: (d: string) => void; onOpen: (t: Task) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const scheduled = board.scheduledOn(date);
  const due = board.dueOn(date);
  const segs = segmentsFor(events, date);
  const total = scheduled.length + due.length + segs.length;
  const isToday = date === board.today;
  const weekend = isWeekend(date);
  const shown = [
    ...due.map((d) => ({ type: 'due' as const, task: d.task, dueKind: d.kind })),
    ...segs.map((seg) => ({ type: 'event' as const, seg })),
    ...scheduled.map((task) => ({ type: 'task' as const, task })),
  ];

  return (
    <div
      ref={setNodeRef}
      data-date={date}
      className={cn(
        'flex min-h-16 flex-col gap-1 rounded-md border p-1 transition-colors sm:min-h-28',
        weekend ? 'weekend-surface border-weekend-line/40' : 'bg-card',
        !inMonth && 'opacity-50',
        isToday && 'ring-2 ring-primary',
        isOver && 'border-primary bg-accent/60 ring-2 ring-primary',
      )}
    >
      <button
        type="button"
        onClick={() => onMore(date)}
        aria-label={`${fmtLong(date)}${total ? `, ${total} item${total > 1 ? 's' : ''}` : ''}`}
        className={cn(
          'flex min-h-6 items-center justify-between rounded-sm px-1 text-left text-xs tabular-nums hover:bg-accent',
          isToday && 'font-bold text-primary',
        )}
      >
        <span>{Number(date.slice(8))}</span>
        {total > 0 && <span className="rounded-sm bg-muted px-1 text-[10px] sm:hidden">{total}</span>}
      </button>

      {/* ≥sm: show items inline; below sm the count badge + tap-to-open day sheet is used */}
      <div className="hidden flex-col gap-0.5 sm:flex">
        {shown.slice(0, MAX_ITEMS).map((it) =>
          it.type === 'event' ? (
            <EventTag key={`${it.seg.event.id}-${date}`} event={it.seg.event} startMin={it.seg.allDay ? undefined : it.seg.startMin} />
          ) : it.type === 'due' ? (
            <button
              key={`${it.task.id}-${it.dueKind}`}
              type="button"
              onClick={() => onOpen(it.task)}
              className={cn(
                'flex items-center gap-1 truncate rounded-sm bg-background/60 px-1 py-0.5 text-left text-[11px] leading-4',
                it.dueKind === 'hard' ? 'due-hard text-hard' : 'due-soft text-soft',
              )}
              title={`${it.dueKind === 'hard' ? 'Hard due' : 'Soft target'}: ${it.task.title}`}
            >
              {it.dueKind === 'hard' ? <Flag className="size-3 shrink-0" aria-hidden /> : <Hourglass className="size-3 shrink-0" aria-hidden />}
              <span className="truncate text-foreground">{it.task.title}</span>
            </button>
          ) : (
            <MiniChip key={it.task.id} task={it.task} project={board.projectById.get(it.task.projectId)?.name} onOpen={onOpen} />
          ),
        )}
        {shown.length > MAX_ITEMS && (
          <button type="button" onClick={() => onMore(date)} className="rounded-sm px-1 text-left text-[11px] text-muted-foreground hover:text-foreground">
            +{shown.length - MAX_ITEMS} more
          </button>
        )}
      </div>
    </div>
  );
}

export function MonthView({ board, ...h }: { board: Board } & Handlers) {
  const [anchor, setAnchor] = useState(startOfMonth(board.today));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const weeks = monthGrid(anchor);
  const events = useCalendarEvents(weeks[0]![0]!, weeks.at(-1)!.at(-1)!);

  const tray = board.visible.filter((t) => !t.done && !t.scheduledDate && board.unblocked(t));
  const dayScheduled = openDay ? board.scheduledOn(openDay) : [];
  const dayDue = openDay ? board.dueOn(openDay) : [];
  const dayEvents = openDay ? segmentsFor(events, openDay) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold">{fmtMonth(anchor)}</h2>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="size-10" aria-label="Previous month" onClick={() => setAnchor(addMonths(anchor, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setAnchor(startOfMonth(board.today))}>Today</Button>
          <Button variant="outline" size="icon" className="size-10" aria-label="Next month" onClick={() => setAnchor(addMonths(anchor, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={fmtMonth(anchor)}>
        {weeks[0]!.map((d) => (
          <div
            key={d}
            className={cn(
              'px-1 pb-0.5 text-center text-xs font-medium text-muted-foreground',
              isWeekend(d) && 'font-normal uppercase italic tracking-wider text-oi-sky',
            )}
          >
            {weekdayShort(d)}
          </div>
        ))}
        {weeks.flat().map((d) => (
          <DayCell key={d} date={d} inMonth={d.slice(0, 7) === anchor.slice(0, 7)} board={board} events={events} onMore={setOpenDay} onOpen={h.onOpen} />
        ))}
      </div>

      <details open className="rounded-xl border bg-card p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Available to schedule <span className="text-muted-foreground">({tray.length}) — drag onto a day</span>
        </summary>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tray.map((t) => (
            <li key={t.id}>
              <TaskChip
                task={t}
                urgency={board.urgencies.get(t.id)}
                days={board.days}
                today={board.today}
                projectName={board.projectById.get(t.projectId)?.name}
                {...h}
              />
            </li>
          ))}
          {!tray.length && <li className="text-sm text-muted-foreground">Nothing available right now.</li>}
        </ul>
      </details>

      <Dialog open={!!openDay} onOpenChange={(o) => !o && setOpenDay(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{openDay && fmtLong(openDay)}</DialogTitle>
            <DialogDescription>
              {dayScheduled.length} scheduled · {dayDue.length} due marker{dayDue.length === 1 ? '' : 's'} · {dayEvents.length} calendar event{dayEvents.length === 1 ? '' : 's'}
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5">
            {dayEvents.map((sg) => (
              <li key={sg.event.id}>
                <EventTag event={sg.event} startMin={sg.allDay ? undefined : sg.startMin} className="py-1.5 text-xs" />
              </li>
            ))}
            {openDay &&
              dayDue.map(({ task, kind }) => (
                <li key={`${task.id}-${kind}`} className={cn('rounded-md bg-background/60 px-2 py-1.5 text-sm', kind === 'hard' ? 'due-hard' : 'due-soft')}>
                  <DueMark kind={kind} date={openDay} className="mb-0.5 border-0 px-0" />
                  <button type="button" className="block text-left" onClick={() => { setOpenDay(null); h.onOpen(task); }}>
                    {task.title}
                  </button>
                </li>
              ))}
            {dayScheduled.map((t) => (
              <li key={t.id}>
                <TaskChip
                  task={t}
                  scheduled
                  urgency={board.urgencies.get(t.id)}
                  days={board.days}
                  today={board.today}
                  projectName={board.projectById.get(t.projectId)?.name}
                  {...h}
                  onOpen={(task) => { setOpenDay(null); h.onOpen(task); }}
                />
              </li>
            ))}
            {!dayScheduled.length && !dayDue.length && !dayEvents.length && <li className="text-sm text-muted-foreground">Nothing on this day.</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

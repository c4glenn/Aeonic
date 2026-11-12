import { useEffect, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Flag } from 'lucide-react';
import { clampBlock, DEFAULT_DURATION, isWeekend, layoutOverlaps, MIN_DURATION, SNAP_MINUTES, timeToMinutes } from '@aeonic/domain';
import type { CalendarEvent, Task } from '@aeonic/client';
import { calendarColor, fmtClock, fmtHour, segmentsFor, type DaySegment } from '@/lib/events';
import { eventTitle } from '@/components/event-marks';
import type { Board } from '@/lib/board';
import { cn } from '@/lib/utils';
import { GRID_COLS, HOUR_PX, INITIAL_SCROLL_HOUR, PX_PER_MIN } from './time-constants';

export interface Ghost {
  date: string;
  startMin: number;
  duration: number;
}

interface Props {
  board: Board;
  events: CalendarEvent[];
  ghost: Ghost | null;
  onOpen: (t: Task) => void;
  /** Called once when a resize gesture ends with a new duration. */
  onResize: (t: Task, durationMinutes: number) => void;
}

const range = (start: number, dur: number) => `${fmtClock(start)} – ${fmtClock(start + dur)}`;

function TaskBlock({
  task, lane, lanes, projectName, onOpen, onResize,
}: {
  task: Task; lane: number; lanes: number; projectName?: string; onOpen: (t: Task) => void; onResize: Props['onResize'];
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } });
  const [live, setLive] = useState<number | null>(null);
  /** Length requested by keyboard but not yet reflected in props, so held-down key repeats accumulate. */
  const pending = useRef<number | null>(null);
  useEffect(() => {
    pending.current = null;
  }, [task.durationMinutes]);
  const start = timeToMinutes(task.startTime!);
  const dur = live ?? task.durationMinutes ?? DEFAULT_DURATION;
  const height = Math.max(dur * PX_PER_MIN, 14);

  const startResize = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const d0 = dur;
    let latest = d0;
    const move = (ev: PointerEvent) => {
      latest = clampBlock(start, d0 + (ev.clientY - y0) / PX_PER_MIN).duration;
      setLive(latest);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setLive(null);
      if (latest !== d0) onResize(task, latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const nudge = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const cur = pending.current ?? dur;
    const next = clampBlock(start, cur + (e.key === 'ArrowDown' ? SNAP_MINUTES : -SNAP_MINUTES)).duration;
    if (next === cur) return;
    pending.current = next;
    onResize(task, next);
  };

  return (
    <div
      ref={setNodeRef}
      data-block={task.id}
      role="group"
      aria-label={`${task.title}, ${range(start, dur)}`}
      {...listeners}
      className={cn(
        'absolute z-10 cursor-grab select-none overflow-hidden rounded-md border border-primary/60 bg-primary text-primary-foreground shadow-sm active:cursor-grabbing',
        task.hardDue && 'border-l-[4px] border-l-hard',
        !task.hardDue && task.softDue && 'border-l-[4px] border-dashed border-l-soft',
        isDragging && 'opacity-40',
        live !== null && 'ring-2 ring-ring',
      )}
      style={{
        top: start * PX_PER_MIN,
        height,
        left: `calc(${(lane / lanes) * 100}% + 1px)`,
        width: `calc(${100 / lanes}% - 3px)`,
      }}
      title={`${task.title} · ${range(start, dur)}${projectName ? ` · ${projectName}` : ''}`}
    >
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="block w-full px-1.5 pt-0.5 text-left text-xs font-semibold leading-tight"
      >
        <span className={cn('block', height < 30 ? 'truncate' : 'line-clamp-2')}>{task.title}</span>
        {height >= 38 && <span className="block text-[11px] font-normal opacity-80">{range(start, dur)}</span>}
        {height >= 62 && projectName && <span className="block truncate text-[11px] font-normal opacity-70">{projectName}</span>}
      </button>
      {task.hardDue && height >= 38 && <Flag className="absolute right-1 top-1 size-3 opacity-70" aria-hidden />}
      <button
        type="button"
        aria-label={`Resize ${task.title}: ${dur} minutes. Drag, or use up and down arrow keys`}
        className="absolute inset-x-0 bottom-0 z-10 flex h-3 cursor-ns-resize touch-none items-end justify-center focus-visible:outline-offset-[-2px]"
        onPointerDown={startResize}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onKeyDown={nudge}
      >
        <span className="mb-0.5 h-0.5 w-6 rounded-full bg-primary-foreground/60" aria-hidden />
      </button>
    </div>
  );
}

function EventBlock({ seg, lane, lanes }: { seg: DaySegment; lane: number; lanes: number }) {
  const dur = Math.max(seg.endMin - seg.startMin, MIN_DURATION);
  const height = Math.max(dur * PX_PER_MIN, 14);
  return (
    <div
      data-event={seg.event.id}
      className="event-surface absolute z-[5] overflow-hidden rounded-md px-1.5 py-0.5 text-xs leading-tight"
      style={{
        ['--cal' as string]: calendarColor(seg.event.color),
        top: seg.startMin * PX_PER_MIN,
        height,
        left: `calc(${(lane / lanes) * 100}% + 1px)`,
        width: `calc(${100 / lanes}% - 3px)`,
      }}
      title={eventTitle(seg.event, seg.startMin)}
    >
      <span className={cn('block font-medium', height < 30 ? 'truncate' : 'line-clamp-2')}>{seg.event.title}</span>
      {height >= 38 && <span className="block text-[11px] text-muted-foreground">{range(seg.startMin, dur)}</span>}
      {height >= 62 && <span className="block truncate text-[11px] text-muted-foreground">{seg.event.calendarName}</span>}
    </div>
  );
}

const lines = {
  backgroundImage: [
    `linear-gradient(to bottom, color-mix(in srgb, var(--border) 90%, transparent) 1px, transparent 1px)`,
    `linear-gradient(to bottom, color-mix(in srgb, var(--border) 40%, transparent) 1px, transparent 1px)`,
  ].join(','),
  backgroundSize: `100% ${HOUR_PX}px, 100% ${HOUR_PX / 2}px`,
};

function TimeColumn({
  date, board, events, ghost, onOpen, onResize, nowMin,
}: { date: string; nowMin: number | null } & Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `time:${date}` });
  const timed = board.scheduledOn(date).filter((t) => t.startTime);
  const segs = segmentsFor(events, date).filter((s) => !s.allDay);

  const items = [
    ...timed.map((t) => ({ id: `t:${t.id}`, start: timeToMinutes(t.startTime!), end: timeToMinutes(t.startTime!) + (t.durationMinutes ?? DEFAULT_DURATION) })),
    ...segs.map((s, i) => ({ id: `e:${i}`, start: s.startMin, end: Math.max(s.endMin, s.startMin + MIN_DURATION) })),
  ];
  const placed = new Map(layoutOverlaps(items).map((p) => [p.id, p]));

  return (
    <div
      ref={setNodeRef}
      data-timecol={date}
      className={cn(
        'relative overflow-hidden rounded-lg border',
        isWeekend(date) ? 'weekend-surface border-weekend-line/40' : 'bg-card',
        date === board.today && 'ring-1 ring-primary/70',
        isOver && 'border-primary ring-2 ring-primary',
      )}
      style={{ height: 24 * HOUR_PX }}
    >
      <div className="pointer-events-none absolute inset-0" style={lines} aria-hidden />
      {segs.map((s, i) => {
        const p = placed.get(`e:${i}`)!;
        return <EventBlock key={`${s.event.id}-${i}`} seg={s} lane={p.lane} lanes={p.lanes} />;
      })}
      {timed.map((t) => {
        const p = placed.get(`t:${t.id}`)!;
        return (
          <TaskBlock
            key={t.id}
            task={t}
            lane={p.lane}
            lanes={p.lanes}
            projectName={board.projectById.get(t.projectId)?.name}
            onOpen={onOpen}
            onResize={onResize}
          />
        );
      })}
      {ghost && ghost.date === date && (
        <div
          data-ghost
          className="pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-dashed border-primary bg-primary/25 px-1 text-[11px] font-medium"
          style={{ top: ghost.startMin * PX_PER_MIN, height: ghost.duration * PX_PER_MIN }}
        >
          {range(ghost.startMin, ghost.duration)}
        </div>
      )}
      {nowMin !== null && date === board.today && (
        <div className="pointer-events-none absolute inset-x-0 z-30 flex items-center" style={{ top: nowMin * PX_PER_MIN - 1 }} aria-hidden>
          <span className="size-2 -translate-x-1 rounded-full bg-oi-pink" />
          <span className="h-0.5 flex-1 bg-oi-pink" />
        </div>
      )}
    </div>
  );
}

export function TimeGrid(props: Props) {
  const { board } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // open near the working day (or a bit before the first timed item, whichever is earlier)
    const first = board.visible
      .filter((t) => t.startTime && !t.done)
      .map((t) => timeToMinutes(t.startTime!) / 60);
    const hour = Math.max(0, Math.min(INITIAL_SCROLL_HOUR, ...first) - 0.5);
    if (scroller.current) scroller.current.scrollTop = hour * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={scroller} data-testid="time-grid" data-autoscroll="pointer" className="relative max-h-[clamp(280px,42dvh,520px)] overflow-y-auto overscroll-contain">
      <div className="grid gap-2" style={{ gridTemplateColumns: GRID_COLS }}>
        <div className="relative" style={{ height: 24 * HOUR_PX }} aria-hidden>
          {Array.from({ length: 24 }, (_, h) =>
            h === 0 ? null : (
              <span key={h} className="absolute right-1 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {fmtHour(h)}
              </span>
            ),
          )}
        </div>
        {board.days.map((d) => (
          <TimeColumn key={d} date={d} nowMin={nowMin} {...props} />
        ))}
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Flag, Hourglass } from 'lucide-react';
import { addDays, daysBetween, isWeekend } from '@aeonic/domain';
import type { CalendarEvent, Task } from '@aeonic/client';
import { useCalendarEvents } from '@/lib/api';
import { calendarColor, eventDates } from '@/lib/events';
import { eventTitle } from '@/components/event-marks';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Board } from '@/lib/board';
import { fmtLong, fmtMonthShort, fmtShort } from '@/lib/dates';
import { cn } from '@/lib/utils';

const ZOOMS = { 14: 64, 30: 34, 60: 20 } as const;
type Zoom = keyof typeof ZOOMS;
const ROW = 40;
const HEAD = 56;

interface LaneItem {
  event: CalendarEvent;
  from: number;
  to: number;
}
type Row =
  | { kind: 'project'; id: string; name: string }
  | { kind: 'task'; task: Task }
  | { kind: 'cal'; id: string; name: string; color: string }
  | { kind: 'lane'; items: LaneItem[] };

/** Greedy interval packing so overlapping events of one calendar get their own sub-rows. */
function packLanes(items: LaneItem[]): LaneItem[][] {
  const lanes: LaneItem[][] = [];
  for (const it of [...items].sort((a, b) => a.from - b.from || b.to - a.to)) {
    const lane = lanes.find((l) => l[l.length - 1]!.to < it.from);
    if (lane) lane.push(it);
    else lanes.push([it]);
  }
  return lanes;
}

const hasDates = (t: Task) => !!(t.scheduledDate || t.hardDue || t.softDue);

/**
 * Timeline: one row per task. A solid block marks the scheduled day, a line runs from it to each
 * due date (solid+heavy for hard, dashed+light for soft) ending in a flag / hourglass marker.
 * Arrows show blocker → dependent order; a vermillion dashed arrow means the order is violated.
 */
export function GanttView({ board, onOpen }: { board: Board; onOpen: (t: Task) => void }) {
  const [zoom, setZoom] = useState<Zoom>(30);
  const [offset, setOffset] = useState(0);
  const colW = ZOOMS[zoom];
  const start = addDays(board.today, -2 + offset);
  const days = useMemo(() => Array.from({ length: zoom }, (_, i) => addDays(start, i)), [start, zoom]);
  const width = zoom * colW;
  const events = useCalendarEvents(days[0]!, days[zoom - 1]!);

  const { rows, hidden } = useMemo(() => {
    const out: Row[] = [];
    let hiddenCount = 0;
    for (const p of board.projects) {
      const tasks = board.visible.filter((t) => t.projectId === p.id);
      const dated = tasks.filter(hasDates);
      hiddenCount += tasks.length - dated.length;
      if (!dated.length) continue;
      out.push({ kind: 'project', id: p.id, name: p.name });
      for (const task of dated) out.push({ kind: 'task', task });
    }

    // one group per calendar that has something in range
    const byCal = new Map<string, { name: string; color: string; items: LaneItem[] }>();
    for (const event of events) {
      const { first, last } = eventDates(event);
      const from = Math.max(0, daysBetween(start, first));
      const to = Math.min(zoom - 1, daysBetween(start, last));
      if (to < 0 || from > zoom - 1 || to < from) continue;
      const g = byCal.get(event.calendarId) ?? { name: event.calendarName, color: event.color, items: [] };
      g.items.push({ event, from, to });
      byCal.set(event.calendarId, g);
    }
    for (const [id, g] of byCal) {
      out.push({ kind: 'cal', id, name: g.name, color: g.color });
      for (const items of packLanes(g.items)) out.push({ kind: 'lane', items });
    }
    return { rows: out, hidden: hiddenCount };
  }, [board.projects, board.visible, events, start, zoom]);

  const x = (date: string) => daysBetween(start, date) * colW;
  const inRange = (date: string) => {
    const i = daysBetween(start, date);
    return i >= 0 && i < zoom;
  };
  const rowTop = (i: number) => HEAD + i * ROW;
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => r.kind === 'task' && rowIndex.set(r.task.id, i));

  // month label segments for the header
  const months: { label: string; from: number; span: number }[] = [];
  days.forEach((d, i) => {
    const label = fmtMonthShort(d);
    const last = months.at(-1);
    if (last && last.label === label) last.span++;
    else months.push({ label, from: i, span: 1 });
  });

  const edges = rows.flatMap((r) => {
    if (r.kind !== 'task' || !r.task.scheduledDate) return [];
    const t = r.task;
    const ts: string = r.task.scheduledDate;
    return t.blockedBy.flatMap((bid) => {
      const b = board.taskById.get(bid);
      const bi = rowIndex.get(bid);
      if (!b?.scheduledDate || bi === undefined) return [];
      const ti = rowIndex.get(t.id)!;
      if (!inRange(b.scheduledDate) && !inRange(ts)) return [];
      return [{
        key: `${bid}->${t.id}`,
        x1: x(b.scheduledDate) + colW - 2, y1: rowTop(bi) + ROW / 2,
        x2: x(ts) + 2, y2: rowTop(ti) + ROW / 2,
        violated: ts < b.scheduledDate,
      }];
    });
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="size-10" aria-label="Earlier" onClick={() => setOffset(offset - Math.round(zoom / 2))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setOffset(0)}>Today</Button>
          <Button variant="outline" size="icon" className="size-10" aria-label="Later" onClick={() => setOffset(offset + Math.round(zoom / 2))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <ToggleGroup type="single" variant="outline" value={String(zoom)} onValueChange={(v) => v && setZoom(Number(v) as Zoom)} aria-label="Zoom">
          <ToggleGroupItem value="14" className="h-10 px-3">2 weeks</ToggleGroupItem>
          <ToggleGroupItem value="30" className="h-10 px-3">30 days</ToggleGroupItem>
          <ToggleGroupItem value="60" className="h-10 px-3">60 days</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Legend />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Nothing to plot yet — schedule a subtask or give it a due date.
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-card" data-testid="gantt">
          <div className="relative flex min-w-max">
            {/* sticky label column */}
            <div className="sticky left-0 z-20 w-36 shrink-0 border-r bg-card sm:w-56">
              <div style={{ height: HEAD }} className="flex items-end border-b px-2 pb-1 text-xs text-muted-foreground">Task</div>
              {rows.map((r, i) =>
                r.kind === 'project' ? (
                  <div key={`p-${r.id}`} style={{ height: ROW }} className="flex items-center border-b bg-muted px-2 font-display text-sm font-semibold">
                    <span className="truncate">{r.name}</span>
                  </div>
                ) : r.kind === 'cal' ? (
                  <div key={`c-${r.id}`} style={{ height: ROW }} className="flex items-center gap-1.5 border-b bg-muted px-2 font-display text-sm font-semibold">
                    <CalendarDays className="size-4 shrink-0" style={{ color: calendarColor(r.color) }} aria-hidden />
                    <span className="truncate">{r.name}</span>
                  </div>
                ) : r.kind === 'lane' ? (
                  <div key={`l-${i}`} style={{ height: ROW }} className="border-b" aria-hidden />
                ) : (
                  <button
                    key={r.task.id}
                    type="button"
                    style={{ height: ROW }}
                    onClick={() => onOpen(r.task)}
                    className={cn('flex w-full items-center border-b px-2 text-left text-sm hover:bg-accent', r.task.done && 'line-through opacity-60')}
                    title={r.task.title}
                  >
                    <span className="truncate">{r.task.title}</span>
                  </button>
                ),
              )}
            </div>

            {/* timeline */}
            <div className="relative" style={{ width, height: HEAD + rows.length * ROW }}>
              {days.map((d, i) =>
                isWeekend(d) ? (
                  <div key={`w-${d}`} className="weekend-surface absolute inset-y-0 opacity-70" style={{ left: i * colW, width: colW }} aria-hidden />
                ) : null,
              )}

              {/* header */}
              {months.map((m) => (
                <div key={m.label + m.from} className="absolute flex h-7 items-center border-b border-l px-1.5 text-xs font-medium" style={{ left: m.from * colW, width: m.span * colW, top: 0 }}>
                  <span className="truncate">{m.label}</span>
                </div>
              ))}
              {days.map((d, i) => (
                <div
                  key={d}
                  title={fmtLong(d)}
                  className={cn('absolute flex h-7 items-center justify-center border-b text-[11px] tabular-nums text-muted-foreground', isWeekend(d) && 'text-oi-sky')}
                  style={{ left: i * colW, width: colW, top: 28 }}
                >
                  {(colW >= 30 || d.slice(8) === '01' || new Date(d + 'T00:00:00Z').getUTCDay() === 1) && (
                    <span className={cn('rounded-sm px-1', d === board.today && 'bg-primary font-semibold text-primary-foreground')}>{Number(d.slice(8))}</span>
                  )}
                </div>
              ))}

              {/* row separators */}
              {rows.map((r, i) => (
                <div key={`s-${i}`} className={cn('absolute inset-x-0 border-b', (r.kind === 'project' || r.kind === 'cal') && 'bg-muted/60')} style={{ top: rowTop(i), height: ROW }} />
              ))}

              {inRange(board.today) && (
                <div className="absolute z-10 w-0.5 bg-primary" style={{ left: x(board.today) + colW / 2 - 1, top: 0, bottom: 0 }} aria-label="Today" />
              )}

              <svg data-testid="gantt-svg" className="pointer-events-none absolute left-0 top-0 z-10" width={width} height={HEAD + rows.length * ROW} aria-hidden>
                <defs>
                  <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--muted-foreground)" />
                  </marker>
                  <marker id="arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--oi-vermillion)" />
                  </marker>
                </defs>
                {edges.map((e) => (
                  <path
                    key={e.key}
                    data-edge={e.key}
                    d={`M${e.x1} ${e.y1} C${e.x1 + 18} ${e.y1}, ${e.x2 - 18} ${e.y2}, ${e.x2} ${e.y2}`}
                    fill="none"
                    stroke={e.violated ? 'var(--oi-vermillion)' : 'var(--muted-foreground)'}
                    strokeWidth={1.5}
                    strokeDasharray={e.violated ? '4 3' : undefined}
                    markerEnd={e.violated ? 'url(#arrow-bad)' : 'url(#arrow)'}
                  />
                ))}
              </svg>

              {rows.map((r, i) => {
                if (r.kind === 'lane') {
                  return (
                    <div key={`ln-${i}`}>
                      {r.items.map(({ event, from, to }) => (
                        <div
                          key={event.id}
                          data-event={event.id}
                          className="event-surface absolute z-[5] flex items-center gap-1 overflow-hidden rounded-sm px-1 text-[11px]"
                          style={{
                            ['--cal' as string]: calendarColor(event.color),
                            left: from * colW + 2,
                            width: (to - from + 1) * colW - 4,
                            top: rowTop(i) + 8,
                            height: ROW - 16,
                          }}
                          title={eventTitle(event)}
                        >
                          <span className="truncate">{event.title}</span>
                        </div>
                      ))}
                    </div>
                  );
                }
                if (r.kind !== 'task') return null;
                const t = r.task;
                const top = rowTop(i);
                const sched = t.scheduledDate;
                const dues = [
                  ...(t.softDue ? [{ kind: 'soft' as const, date: t.softDue }] : []),
                  ...(t.hardDue ? [{ kind: 'hard' as const, date: t.hardDue }] : []),
                ];
                const both = dues.length === 2;
                const clamp = (px: number) => Math.max(0, Math.min(width, px));
                return (
                  <div key={t.id} className={cn(t.done && 'opacity-50')}>
                    {sched &&
                      dues.map((d) => {
                        const from = x(sched) + colW / 2;
                        const to = x(d.date) + colW / 2;
                        if (to <= from) return null;
                        const y = top + ROW / 2 + (both ? (d.kind === 'soft' ? -4 : 4) : 0);
                        return (
                          <div
                            key={d.kind}
                            aria-hidden
                            className={cn('absolute', d.kind === 'hard' ? 'border-t-[3px] border-solid border-hard' : 'border-t-2 border-dashed border-soft')}
                            style={{ left: clamp(from), width: Math.max(0, clamp(to) - clamp(from)), top: y - 1 }}
                          />
                        );
                      })}
                    {sched && inRange(sched) && (
                      <button
                        type="button"
                        onClick={() => onOpen(t)}
                        title={`${t.title} — scheduled ${fmtShort(sched)}`}
                        aria-label={`${t.title}, scheduled ${fmtShort(sched)}`}
                        className="absolute z-[5] rounded-sm bg-primary hover:brightness-110"
                        style={{ left: x(sched) + 2, width: colW - 4, top: top + 9, height: ROW - 18 }}
                      />
                    )}
                    {dues.map((d) =>
                      inRange(d.date) ? (
                        <button
                          key={`m-${d.kind}`}
                          type="button"
                          onClick={() => onOpen(t)}
                          title={`${d.kind === 'hard' ? 'Hard due' : 'Soft target'} ${fmtShort(d.date)} — ${t.title}`}
                          aria-label={`${d.kind === 'hard' ? 'Due' : 'Target'} ${fmtShort(d.date)}: ${t.title}`}
                          className={cn(
                            'absolute z-[6] flex size-[22px] items-center justify-center rounded-full bg-card',
                            d.kind === 'hard' ? 'border-2 border-solid border-hard text-hard' : 'border border-dashed border-soft text-soft',
                          )}
                          style={{ left: x(d.date) + colW / 2 - 11, top: top + ROW / 2 - 11 }}
                        >
                          {d.kind === 'hard' ? <Flag className="size-3" aria-hidden /> : <Hourglass className="size-3" aria-hidden />}
                        </button>
                      ) : null,
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          {hidden} task{hidden === 1 ? ' has' : 's have'} no schedule or due date and aren’t shown here.
        </p>
      )}
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      <li className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-primary" /> Scheduled</li>
      <li className="flex items-center gap-1.5"><Flag className="size-3.5 text-hard" /> Hard due (solid)</li>
      <li className="flex items-center gap-1.5"><Hourglass className="size-3.5 text-soft" /> Soft target (dashed)</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t border-muted-foreground" /> Blocks →</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-oi-vermillion" /> Order conflict</li>
      <li className="flex items-center gap-1.5"><span className="event-surface inline-block h-3 w-4 rounded-sm" /> Calendar event</li>
    </ul>
  );
}

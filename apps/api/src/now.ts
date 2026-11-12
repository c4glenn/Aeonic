import { DEFAULT_DURATION, zonedToInstant, type Task } from '@aeonic/domain';
import type { CalendarEventView } from './calendars';

export interface NowItem {
  kind: 'task' | 'event';
  id: string;
  title: string;
  /** ISO-8601 instants (UTC). */
  start: string;
  end: string;
  projectName: string | null;
  calendarName: string | null;
  /** Calendar's color key (sky, orange, …) for events. */
  calendarColor: string | null;
}

export interface NowResult {
  now: string;
  /** Happening right now (soonest-ending if several overlap). */
  current: NowItem | null;
  /** The next thing to start after now (also returned while something is current). */
  next: NowItem | null;
}

interface Timed extends NowItem {
  startMs: number;
  endMs: number;
}

/**
 * Pure: what is going on at `nowMs`? Only things with clock times count — timed tasks (their wall-clock
 * time is read in `tz`) and timed calendar events. Untimed tasks, all-day events and done tasks are ignored.
 */
export function computeNow(input: {
  nowMs: number;
  tz: string;
  tasks: readonly Task[];
  projectNames: ReadonlyMap<string, string>;
  events: readonly CalendarEventView[];
}): NowResult {
  const items: Timed[] = [];

  for (const t of input.tasks) {
    if (t.done || !t.scheduledDate || !t.startTime) continue;
    const startMs = zonedToInstant(t.scheduledDate, t.startTime, input.tz);
    // the schema keeps blocks within one day; compute the end from the minutes so DST can't skew it
    const endMs = startMs + (t.durationMinutes ?? DEFAULT_DURATION) * 60_000;
    items.push({
      kind: 'task', id: t.id, title: t.title,
      start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
      projectName: input.projectNames.get(t.projectId) ?? null, calendarName: null, calendarColor: null,
      startMs, endMs,
    });
  }

  for (const e of input.events) {
    if (e.allDay) continue;
    const startMs = Date.parse(e.start);
    const endMs = Math.max(Date.parse(e.end), startMs);
    items.push({
      kind: 'event', id: e.id, title: e.title, start: e.start, end: e.end,
      projectName: null, calendarName: e.calendarName, calendarColor: e.color, startMs, endMs,
    });
  }

  const strip = ({ startMs: _s, endMs: _e, ...item }: Timed): NowItem => item;
  const current = items
    .filter((i) => i.startMs <= input.nowMs && input.nowMs < i.endMs)
    .sort((a, b) => a.endMs - b.endMs || a.startMs - b.startMs || a.title.localeCompare(b.title))[0];
  const next = items
    .filter((i) => i.startMs > input.nowMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.title.localeCompare(b.title))[0];

  return {
    now: new Date(input.nowMs).toISOString(),
    current: current ? strip(current) : null,
    next: next ? strip(next) : null,
  };
}

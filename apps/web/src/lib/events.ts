import type { CalendarEvent } from '@aeonic/client';
import { addDays } from '@aeonic/domain';

export interface DaySegment {
  event: CalendarEvent;
  date: string;
  /** All-day events carry no clock times. */
  allDay: boolean;
  /** Minutes from local midnight, clipped to this day. */
  startMin: number;
  endMin: number;
}

const MIN = 60_000;

function localMidnight(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/**
 * Portions of `events` that fall on local `date`. All-day events (exclusive end, as in ICS) match by
 * date string; timed events are UTC instants, so they're clipped to this day in the browser's timezone.
 */
export function segmentsFor(events: readonly CalendarEvent[], date: string): DaySegment[] {
  const dayStart = localMidnight(date).getTime();
  const dayEnd = localMidnight(addDays(date, 1)).getTime();
  const out: DaySegment[] = [];
  for (const event of events) {
    if (event.allDay) {
      if (event.start <= date && date < event.end) out.push({ event, date, allDay: true, startMin: 0, endMin: 1440 });
      continue;
    }
    const s = new Date(event.start).getTime();
    const e = Math.max(new Date(event.end).getTime(), s);
    // zero-length events still occupy the instant they start
    if (e <= dayStart && s < dayStart) continue;
    if (s >= dayEnd) continue;
    if (e === s && (s < dayStart || s >= dayEnd)) continue;
    out.push({
      event,
      date,
      allDay: false,
      startMin: Math.max(0, Math.round((s - dayStart) / MIN)),
      endMin: Math.min(1440, Math.round((e - dayStart) / MIN)),
    });
  }
  return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMin - b.startMin);
}

/** Dates (inclusive) an event touches, for coarse day-resolution views (month, gantt). */
export function eventDates(event: CalendarEvent): { first: string; last: string } {
  if (event.allDay) return { first: event.start, last: addDays(event.end, -1) < event.start ? event.start : addDays(event.end, -1) };
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const first = toLocal(event.start);
  // an event ending exactly at local midnight belongs to the previous day
  const end = new Date(new Date(event.end).getTime() - 1);
  const last = toLocal(new Date(Math.max(end.getTime(), new Date(event.start).getTime())).toISOString());
  return { first, last };
}

export const calendarColor = (c: string) => `var(--oi-${c})`;

export function fmtClock(min: number): string {
  const d = new Date(2000, 0, 1, Math.floor(min / 60) % 24, min % 60);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' });
}

import { CalendarDays } from 'lucide-react';
import type { CalendarEvent } from '@aeonic/client';
import { calendarColor, fmtClock } from '@/lib/events';
import { cn } from '@/lib/utils';

export const eventTitle = (e: CalendarEvent, startMin?: number) =>
  [
    e.title,
    e.allDay || startMin === undefined ? null : fmtClock(startMin),
    e.location,
    `Calendar: ${e.calendarName}`,
  ]
    .filter(Boolean)
    .join(' · ');

/** One-line event label: stripe + dotted fill + icon. Read-only. */
export function EventTag({ event, startMin, className }: { event: CalendarEvent; startMin?: number; className?: string }) {
  return (
    <div
      className={cn('event-surface flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-[11px] leading-4', className)}
      style={{ ['--cal' as string]: calendarColor(event.color) }}
      title={eventTitle(event, startMin)}
    >
      <CalendarDays className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">
        {!event.allDay && startMin !== undefined && <span className="mr-1 tabular-nums text-muted-foreground">{fmtClock(startMin)}</span>}
        {event.title}
      </span>
    </div>
  );
}

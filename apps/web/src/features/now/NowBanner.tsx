import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CircleDot, Clock, SquareCheckBig } from 'lucide-react';
import { qk, useNowQuery } from '@/lib/api';
import { calendarColor } from '@/lib/events';
import { describeNow } from '@/lib/now';
import { cn } from '@/lib/utils';

/**
 * Header banner:  Current task: “Write spec” ends at 10:30 AM (0:25 left)
 *            or:  Upcoming event: “Standup” starts at 9:00 AM (1:05 away)
 * Hidden when nothing timed is current or coming up.
 */
export function NowBanner({ className }: { className?: string }) {
  const qc = useQueryClient();
  const { data } = useNowQuery();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // tick a few times a minute so the countdown stays honest
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const line = describeNow(data, nowMs);

  // when the clock passes the item's end/start, ask the server what's current now
  const boundary = data?.current ? Date.parse(data.current.end) : data?.next ? Date.parse(data.next.start) : null;
  useEffect(() => {
    if (boundary !== null && nowMs >= boundary) void qc.invalidateQueries({ queryKey: qk.now });
  }, [nowMs, boundary, qc]);

  if (!line) return null;
  const current = line.state === 'Current';
  const isEvent = line.noun === 'event';
  const Icon = isEvent ? CalendarDays : SquareCheckBig;
  const detail = isEvent ? line.item.calendarName : line.item.projectName;

  return (
    <div
      role="status"
      aria-live="off"
      data-testid="now-banner"
      data-state={line.state.toLowerCase()}
      data-kind={line.noun}
      title={detail ? `${isEvent ? 'Calendar' : 'Project'}: ${detail}` : undefined}
      style={isEvent ? { ['--cal' as string]: calendarColor(line.item.calendarColor ?? 'sky') } : undefined}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
        // tasks: solid tint. events: dotted fill + stripe (same language as the calendar views)
        isEvent ? 'event-surface' : 'border border-primary/50 bg-primary/15',
        current && !isEvent && 'border-l-4 border-l-primary',
        className,
      )}
    >
      {current ? <CircleDot className="size-4 shrink-0 text-primary" aria-hidden /> : <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">
        <strong className="font-semibold">
          {line.state} {line.noun}:
        </strong>{' '}
        <span className="font-medium">“{line.item.title}”</span> {line.phrase}{' '}
        <span className="whitespace-nowrap text-muted-foreground">({line.remaining})</span>
      </span>
    </div>
  );
}

import type { components } from '@aeonic/client';

export type NowResponse = components['schemas']['Now'];
export type NowItem = NonNullable<NowResponse['current']>;

export interface NowLine {
  /** "Current" or "Upcoming" — the state, always spelled out (never color alone). */
  state: 'Current' | 'Upcoming';
  /** "task" or "event". */
  noun: 'task' | 'event';
  item: NowItem;
  /** e.g. "ends at 3:30 PM" / "starts Thu 9:00 AM" */
  phrase: string;
  /** e.g. "0:25 left" / "1:05 away" / "1d 3:05 away" */
  remaining: string;
}

/** h:mm, or "Nd h:mm" past 24 hours. Rounds up so the last seconds read 0:01, not 0:00. */
export function fmtRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return `${d ? `${d}d ` : ''}${h}:${String(m).padStart(2, '0')}`;
}

const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Turn the API's {current,next} into the banner's wording, relative to `nowMs` (browser clock). */
export function describeNow(data: NowResponse | undefined, nowMs: number): NowLine | null {
  if (!data) return null;
  const now = new Date(nowMs);

  // Trust the clock over a slightly stale response: an item that already ended/started is handled by the refetch.
  if (data.current && Date.parse(data.current.end) > nowMs) {
    const end = new Date(data.current.end);
    const when = sameDay(end, now) ? clock(end) : `${end.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(end)}`;
    return {
      state: 'Current',
      noun: data.current.kind,
      item: data.current,
      phrase: `ends at ${when}`,
      remaining: `${fmtRemaining(end.getTime() - nowMs)} left`,
    };
  }
  if (data.next && Date.parse(data.next.start) > nowMs) {
    const start = new Date(data.next.start);
    const when = sameDay(start, now) ? clock(start) : `${start.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(start)}`;
    return {
      state: 'Upcoming',
      noun: data.next.kind,
      item: data.next,
      phrase: `starts at ${when}`,
      remaining: `${fmtRemaining(start.getTime() - nowMs)} away`,
    };
  }
  return null;
}

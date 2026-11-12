import ical, { type CalendarResponse, type VEvent } from 'node-ical';
import { HttpError } from './problem';

export interface CalEvent {
  uid: string;
  title: string;
  /** All-day: 'YYYY-MM-DD'. Timed: ISO-8601 instant (UTC). */
  start: string;
  /** All-day: exclusive 'YYYY-MM-DD' (as in ICS). Timed: ISO-8601 instant (UTC). */
  end: string;
  allDay: boolean;
  location: string | null;
}

export type ParsedCalendar = VEvent[];

const MAX_BYTES = 5 * 1024 * 1024;
const DAY = 86_400_000;

export function normalizeUrl(input: string): URL {
  let raw = input.trim();
  if (/^webcal:\/\//i.test(raw)) raw = 'https://' + raw.slice('webcal://'.length);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(422, 'Invalid calendar URL', 'Enter a full http(s):// or webcal:// link');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(422, 'Invalid calendar URL', 'Only http, https and webcal links are supported');
  }
  return url;
}

export async function fetchIcs(url: URL, doFetch: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await doFetch(url, {
      headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5', 'user-agent': 'aeonic-ics/1' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new HttpError(502, 'Could not fetch calendar', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new HttpError(502, 'Could not fetch calendar', `The server answered HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new HttpError(422, 'Calendar too large', 'Limit is 5 MB');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new HttpError(422, 'Calendar too large', 'Limit is 5 MB');
  const text = new TextDecoder('utf-8').decode(buf);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new HttpError(422, 'Not an ICS calendar', 'The link did not return calendar data');
  return text;
}

export function parseIcs(raw: string): ParsedCalendar {
  let data: CalendarResponse;
  try {
    data = ical.sync.parseICS(raw);
  } catch (e) {
    throw new HttpError(422, 'Could not read calendar', e instanceof Error ? e.message : 'Invalid ICS');
  }
  return Object.values(data).filter((x): x is VEvent => !!x && x.type === 'VEVENT');
}

const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'val' in v) return String((v as { val: unknown }).val ?? '');
  return '';
};

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isDateOnly = (d: Date) => (d as Date & { dateOnly?: boolean }).dateOnly === true;

/** Expand every event (including recurrences, exceptions and moved occurrences) intersecting [fromMs, toMs). */
export function expandEvents(events: ParsedCalendar, fromMs: number, toMs: number): CalEvent[] {
  const out: CalEvent[] = [];

  const push = (ev: VEvent, start: Date, end: Date | undefined, summary: unknown, location: unknown) => {
    const allDay = isDateOnly(ev.start);
    const endDate = end ?? (allDay ? new Date(start.getTime() + DAY) : start);
    if (endDate.getTime() <= fromMs && start.getTime() < fromMs) return;
    if (start.getTime() >= toMs) return;
    out.push({
      uid: ev.uid,
      title: text(summary) || '(no title)',
      start: allDay ? localDate(start) : start.toISOString(),
      end: allDay ? localDate(endDate) : endDate.toISOString(),
      allDay,
      location: text(location) || null,
    });
  };

  for (const ev of events) {
    if (!ev.start || ev.status === 'CANCELLED') continue;
    const dur = ev.end ? ev.end.getTime() - ev.start.getTime() : isDateOnly(ev.start) ? DAY : 0;

    if (ev.rrule) {
      const overrides = ev.recurrences ?? {};
      const dates: Date[] = ev.rrule.between(new Date(fromMs - dur - DAY), new Date(toMs), true);
      for (const d of dates) {
        const key = d.toISOString().slice(0, 10);
        if (ev.exdate?.[key] || overrides[key]) continue;
        push(ev, d, new Date(d.getTime() + dur), ev.summary, ev.location);
      }
      // node-ical indexes each override under both 'YYYY-MM-DD' and a full ISO key; use the date keys only
      for (const [key, ov] of Object.entries(overrides)) {
        if (key.length !== 10) continue;
        const o = ov as VEvent;
        if (o.status === 'CANCELLED' || !o.start) continue;
        push({ ...ev, start: o.start } as VEvent, o.start, o.end, o.summary ?? ev.summary, o.location ?? ev.location);
      }
    } else {
      push(ev, ev.start, ev.end, ev.summary, ev.location);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from './db';
import { schema } from './db';
import type { Bus } from './events';
import { expandEvents, fetchIcs, normalizeUrl, parseIcs, type CalEvent, type ParsedCalendar } from './ics';
import { HttpError, notFound } from './problem';

export const CALENDAR_COLORS = ['sky', 'orange', 'green', 'pink', 'yellow', 'vermillion'] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

type Row = typeof schema.calendars.$inferSelect;

export interface CalendarView {
  id: string;
  name: string;
  /** Host only. The full URL often embeds a secret token, so it is never returned. */
  source: string;
  color: CalendarColor;
  enabled: boolean;
  fetchedAt: string | null;
  error: string | null;
}

export interface CalendarEventView extends CalEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  color: CalendarColor;
}

const DAY = 86_400_000;
const asColor = (c: string): CalendarColor => ((CALENDAR_COLORS as readonly string[]).includes(c) ? (c as CalendarColor) : 'sky');

export class Calendars {
  private parsed = new Map<string, ParsedCalendar>();

  constructor(
    private db: Db,
    private bus: Bus,
    private doFetch: typeof fetch = fetch,
  ) {}

  private rows(): Row[] {
    return this.db.select().from(schema.calendars).all();
  }
  private row(id: string): Row {
    const r = this.db.select().from(schema.calendars).where(eq(schema.calendars.id, id)).get();
    if (!r) throw notFound('Calendar');
    return r;
  }
  private view(r: Row): CalendarView {
    let source = 'calendar';
    try {
      source = new URL(r.url).host;
    } catch {
      /* keep default */
    }
    return {
      id: r.id, name: r.name, source, color: asColor(r.color), enabled: r.enabled,
      fetchedAt: r.fetchedAt, error: r.error,
    };
  }

  list(): CalendarView[] {
    return this.rows().map((r) => this.view(r));
  }

  /** Validates by fetching and parsing before anything is stored. */
  async add(input: { name: string; url: string; color?: CalendarColor }): Promise<CalendarView> {
    const url = normalizeUrl(input.url);
    const raw = await fetchIcs(url, this.doFetch);
    const parsed = parseIcs(raw);
    const id = nanoid(10);
    this.db
      .insert(schema.calendars)
      .values({
        id, name: input.name, url: url.toString(),
        color: input.color ?? CALENDAR_COLORS[this.rows().length % CALENDAR_COLORS.length]!,
        enabled: true, raw, fetchedAt: new Date().toISOString(), error: null, createdAt: new Date().toISOString(),
      })
      .run();
    this.parsed.set(id, parsed);
    this.bus.emit('calendar.updated', { id });
    return this.view(this.row(id));
  }

  update(id: string, patch: { name?: string; enabled?: boolean; color?: CalendarColor }): CalendarView {
    this.row(id);
    this.db
      .update(schema.calendars)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.color !== undefined && { color: patch.color }),
      })
      .where(eq(schema.calendars.id, id))
      .run();
    this.bus.emit('calendar.updated', { id });
    return this.view(this.row(id));
  }

  remove(id: string) {
    this.row(id);
    this.db.delete(schema.calendars).where(eq(schema.calendars.id, id)).run();
    this.parsed.delete(id);
    this.bus.emit('calendar.updated', { id });
  }

  /** Re-download one calendar. On failure the previous data is kept and the error is recorded. */
  async refresh(id: string): Promise<CalendarView> {
    const r = this.row(id);
    try {
      const raw = await fetchIcs(normalizeUrl(r.url), this.doFetch);
      const parsed = parseIcs(raw);
      this.db
        .update(schema.calendars)
        .set({ raw, fetchedAt: new Date().toISOString(), error: null })
        .where(eq(schema.calendars.id, id))
        .run();
      this.parsed.set(id, parsed);
    } catch (e) {
      const msg = e instanceof HttpError ? `${e.title}: ${e.detail ?? ''}` : e instanceof Error ? e.message : String(e);
      this.db.update(schema.calendars).set({ error: msg.trim() }).where(eq(schema.calendars.id, id)).run();
    }
    this.bus.emit('calendar.updated', { id });
    return this.view(this.row(id));
  }

  async refreshAll() {
    await Promise.all(this.rows().filter((r) => r.enabled).map((r) => this.refresh(r.id)));
  }

  start(intervalMs: number): () => void {
    const t = setInterval(() => void this.refreshAll(), intervalMs);
    t.unref();
    return () => clearInterval(t);
  }

  private parsedFor(r: Row): ParsedCalendar {
    let p = this.parsed.get(r.id);
    if (!p) {
      try {
        p = r.raw ? parseIcs(r.raw) : [];
      } catch {
        p = [];
      }
      this.parsed.set(r.id, p);
    }
    return p;
  }

  /** Events for local dates [from, to] inclusive. The window is padded so clients in any timezone can clip per day. */
  events(from: string, to: string): CalendarEventView[] {
    const fromMs = Date.parse(from + 'T00:00:00Z') - 1.5 * DAY;
    const toMs = Date.parse(to + 'T00:00:00Z') + 2.5 * DAY;
    return this.rows()
      .filter((r) => r.enabled)
      .flatMap((r) =>
        expandEvents(this.parsedFor(r), fromMs, toMs).map((e) => ({
          ...e,
          id: `${r.id}:${e.uid}:${e.start}`,
          calendarId: r.id,
          calendarName: r.name,
          color: asColor(r.color),
        })),
      );
  }
}

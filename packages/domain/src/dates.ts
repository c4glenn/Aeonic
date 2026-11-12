const MS_PER_DAY = 86_400_000;

export function parseDate(d: string): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return formatDate(parseDate(d) + n * MS_PER_DAY);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / MS_PER_DAY);
}

export function isWeekend(d: string): boolean {
  const dow = new Date(parseDate(d)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function weekFrom(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** "Today" for a given IANA timezone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

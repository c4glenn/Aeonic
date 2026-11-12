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

export function startOfMonth(d: string): string {
  return d.slice(0, 8) + '01';
}

/** Shift to the 1st of the month `n` months away (works across years). */
export function addMonths(d: string, n: number): string {
  const [y, m] = d.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/** Day of week with Monday = 0 … Sunday = 6. */
export function mondayIndex(d: string): number {
  return (new Date(parseDate(d)).getUTCDay() + 6) % 7;
}

/** Weeks (Mon–Sun) covering the month of `anchor`, including leading/trailing days. */
export function monthGrid(anchor: string): string[][] {
  const first = startOfMonth(anchor);
  const gridStart = addDays(first, -mondayIndex(first));
  const next = addMonths(first, 1);
  const lastDay = addDays(next, -1);
  const weeks: string[][] = [];
  for (let start = gridStart; start <= lastDay; start = addDays(start, 7)) weeks.push(weekFrom(start));
  return weeks;
}

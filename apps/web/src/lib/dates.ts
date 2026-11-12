/** Local-time <-> YYYY-MM-DD helpers for the Calendar component (which works with Date objects). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

const utc = (s: string) => new Date(s + 'T00:00:00Z');

export const fmtShort = (s: string) =>
  utc(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const fmtLong = (s: string) =>
  utc(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
export const fmtMonth = (s: string) =>
  utc(s).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const fmtMonthShort = (s: string) =>
  utc(s).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const weekdayShort = (s: string) => utc(s).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });

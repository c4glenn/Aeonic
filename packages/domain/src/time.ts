export const DEFAULT_DURATION = 30;
export const SNAP_MINUTES = 15;
export const MIN_DURATION = 15;
export const DAY_MINUTES = 1440;

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function snapMinutes(min: number, step = SNAP_MINUTES): number {
  return Math.round(min / step) * step;
}

/** Keep a block inside a single day, snapped, with at least MIN_DURATION. */
export function clampBlock(startMin: number, duration: number): { start: number; duration: number } {
  const dur = Math.max(MIN_DURATION, Math.min(DAY_MINUTES, snapMinutes(duration)));
  const start = Math.max(0, Math.min(DAY_MINUTES - dur, snapMinutes(startMin)));
  return { start, duration: dur };
}

export interface Interval {
  id: string;
  start: number;
  end: number;
}
export interface Placed {
  id: string;
  lane: number;
  lanes: number;
}

/**
 * Side-by-side layout for overlapping intervals (calendar style): overlapping items form a cluster,
 * each takes the first free lane, and every item in a cluster shares the cluster's lane count.
 */
export function layoutOverlaps(items: readonly Interval[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const c of cluster) out.push({ ...c, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = it.end;
    cluster.push({ id: it.id, lane });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

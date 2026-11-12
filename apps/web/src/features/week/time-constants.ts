/** Pixels per hour in the week time grid; 15-minute snapping = 12px. */
export const HOUR_PX = 48;
export const PX_PER_MIN = HOUR_PX / 60;
export const GUTTER = '3.25rem';
export const GRID_COLS = `${GUTTER} repeat(7, minmax(0, 1fr))`;
/** Scroll position (hour) the grid opens at. */
export const INITIAL_SCROLL_HOUR = 7;

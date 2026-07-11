import { EPSILON } from '../common/tolerance.js';

export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** merge overlapping/touching intervals, drop empty ones */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end - i.start > EPSILON)
    .slice()
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end + EPSILON) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, cur.end) };
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

/**
 * Complement of `cuts` within [0, length]: the solid spans that remain.
 * The 1D core of wall-with-openings; the 2D boundary-with-holes version
 * lands beside it when hatch/regions need it.
 */
export function subtractIntervals(length: number, cuts: readonly Interval[]): Interval[] {
  const clamped = cuts.map((c) => ({
    start: Math.max(0, c.start),
    end: Math.min(length, c.end),
  }));
  const merged = mergeIntervals(clamped);
  const spans: Interval[] = [];
  let cursor = 0;
  for (const cut of merged) {
    if (cut.start - cursor > EPSILON) spans.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (length - cursor > EPSILON) spans.push({ start: cursor, end: length });
  return spans;
}

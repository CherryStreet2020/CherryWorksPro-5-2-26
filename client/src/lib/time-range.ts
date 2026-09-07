/**
 * Date-range filtering for time-entry lists (client detail Time & Billing tab).
 *
 * Entries carry a plain `YYYY-MM-DD` date. The cutoff is computed in local time
 * from `now`; "all" (or any unknown key) keeps everything.
 */
export type TimeRangeKey = "7d" | "30d" | "90d" | "month" | "all";

export interface DatedEntry { date: string }

export function timeRangeCutoff(timeRange: string, now: Date = new Date()): Date | null {
  const cutoff = new Date(now);
  if (timeRange === "7d") cutoff.setDate(cutoff.getDate() - 7);
  else if (timeRange === "30d") cutoff.setDate(cutoff.getDate() - 30);
  else if (timeRange === "90d") cutoff.setDate(cutoff.getDate() - 90);
  else if (timeRange === "month") { cutoff.setDate(1); cutoff.setHours(0, 0, 0, 0); }
  else return null;
  return cutoff;
}

/** Entries dated on or after the range cutoff. Malformed dates are dropped. */
export function timeEntriesInRange<T extends DatedEntry>(entries: T[], timeRange: string, now: Date = new Date()): T[] {
  const cutoff = timeRangeCutoff(timeRange, now);
  if (!cutoff) return entries;
  return entries.filter(te => {
    const d = new Date(te.date + "T00:00:00");
    return !Number.isNaN(d.getTime()) && d >= cutoff;
  });
}

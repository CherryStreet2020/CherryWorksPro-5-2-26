/**
 * Task #303 — Quiet-hours helpers.
 *
 * Pure functions (no DB, no env access) so they can be unit-tested
 * without mocks. Used by `marketing-failures.ts` to decide, per-admin,
 * whether a non-urgent failure email should be buffered or sent now.
 *
 * Mailbox-reconnect alerts deliberately do NOT consult these helpers
 * because they're action-required.
 */

export interface QuietHoursPrefs {
  quietHoursEnabled?: boolean | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
}

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Parse "HH:MM" → minutes since midnight, or null if malformed. */
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = HHMM_RE.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Returns the offset in milliseconds such that
 *   `new Date(d.getTime() + offset)` reads (in UTC) as the wall-clock
 *   time `d` would show in `tz`.
 *
 * Falls back to 0 (UTC) if `tz` is invalid.
 */
export function tzOffsetMs(d: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(d)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    const hour = parts.hour === "24" ? 0 : Number(parts.hour);
    const asUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      hour,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUTC - d.getTime();
  } catch {
    return 0;
  }
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  minutesSinceMidnight: number;
}

function getZonedParts(d: Date, tz: string): ZonedParts {
  const wallUtc = d.getTime() + tzOffsetMs(d, tz);
  const w = new Date(wallUtc);
  return {
    year: w.getUTCFullYear(),
    month: w.getUTCMonth() + 1,
    day: w.getUTCDate(),
    minutesSinceMidnight: w.getUTCHours() * 60 + w.getUTCMinutes(),
  };
}

/**
 * True when `now` falls inside the configured quiet-hours window.
 * Disabled prefs, missing fields, and malformed values all return false
 * (fail-open: better to wake an admin than to silently lose alerts).
 *
 * Supports wrap-around windows where start > end (e.g. 22:00–07:00).
 * A window with start === end is treated as "always quiet" so admins
 * can opt out of all non-urgent emails by setting both fields equal.
 */
export function isWithinQuietHours(now: Date, prefs: QuietHoursPrefs): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const start = parseHHMM(prefs.quietHoursStart);
  const end = parseHHMM(prefs.quietHoursEnd);
  if (start === null || end === null) return false;
  const tz = prefs.quietHoursTimezone || "UTC";
  const cur = getZonedParts(now, tz).minutesSinceMidnight;
  if (start === end) return true;
  if (start < end) return cur >= start && cur < end;
  // Wrap: in-window when after start OR before end.
  return cur >= start || cur < end;
}

/**
 * Convert a wall-clock instant (year/month/day + minutes-since-midnight
 * in `tz`) to the corresponding UTC `Date`. Re-checks the offset at the
 * candidate instant so DST transitions don't shift the result by an
 * hour.
 */
function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  tz: string,
): Date {
  const wallUtcMs =
    Date.UTC(year, month - 1, day) + minutes * 60_000;
  let offset = tzOffsetMs(new Date(wallUtcMs), tz);
  let candidate = wallUtcMs - offset;
  // Re-evaluate offset at the candidate; iterate once more in case the
  // candidate is itself across a DST seam.
  const offset2 = tzOffsetMs(new Date(candidate), tz);
  if (offset2 !== offset) {
    candidate = wallUtcMs - offset2;
  }
  return new Date(candidate);
}

/**
 * Returns the UTC `Date` of the next end-of-quiet-hours boundary after
 * `now`. Caller should only invoke this when `isWithinQuietHours(now)`
 * is true; for the "always quiet" (start === end) case we return
 * `now + 24h` so the buffer eventually drains rather than wedging
 * forever.
 */
export function nextQuietHoursEnd(now: Date, prefs: QuietHoursPrefs): Date {
  const start = parseHHMM(prefs.quietHoursStart);
  const end = parseHHMM(prefs.quietHoursEnd);
  if (start === null || end === null) return now;
  const tz = prefs.quietHoursTimezone || "UTC";
  const z = getZonedParts(now, tz);
  const cur = z.minutesSinceMidnight;

  // Always-quiet escape hatch — release once a day so the queue drains.
  if (start === end) {
    const target = wallTimeToUtc(z.year, z.month, z.day, end, tz);
    if (target.getTime() <= now.getTime()) {
      return new Date(target.getTime() + 24 * 60 * 60_000);
    }
    return target;
  }

  let dayOffset = 0;
  if (start < end) {
    // Simple range — end is later today (cur < end by precondition).
    dayOffset = 0;
  } else {
    // Wrap window. If we're before midnight in tz (cur >= start), end
    // is tomorrow; otherwise we're already past midnight and end is
    // later today.
    dayOffset = cur >= start ? 1 : 0;
  }

  const baseUtc = Date.UTC(z.year, z.month - 1, z.day) + dayOffset * 24 * 60 * 60_000;
  const w = new Date(baseUtc);
  return wallTimeToUtc(
    w.getUTCFullYear(),
    w.getUTCMonth() + 1,
    w.getUTCDate(),
    end,
    tz,
  );
}

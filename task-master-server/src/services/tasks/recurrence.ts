/**
 * Pure recurrence math — deterministic, I/O-free scheduling core for the
 * task-recurrence feature. Every date is a 'YYYY-MM-DD' calendar string.
 *
 * All calendar advancement uses the DST-safe UTC-noon technique already proven
 * in `nextCalendarDate` (src/services/time/userTime.ts): parse the y/m/d, build
 * `Date.UTC(y, m-1, d, 12)`, add whole days in milliseconds, then read the
 * result back via the UTC getters. Anchoring at 12:00 UTC keeps every step a
 * safe distance from any midnight/DST transition edge, and because no timezone
 * offset is ever applied a +N*24h step always advances exactly N calendar days.
 *
 * The module reads no clock, DB, or timezone — the caller supplies the resolved
 * `anchor`. This keeps every scheduling rule directly property-testable.
 */

import type { RepeatPattern } from '../../types/task';

const MS_PER_DAY = 86_400_000;

/**
 * Return `date` ('YYYY-MM-DD') advanced by `n` calendar days as a zero-padded
 * 'YYYY-MM-DD' string. `n` may be negative or zero.
 *
 * DST-safe: computed as `Date.UTC(y, m-1, d, 12) + n * 86_400_000` then read
 * back through the UTC getters, so no timezone offset is ever applied and the
 * step always advances exactly `n` calendar days (generalizes
 * `nextCalendarDate`, which is the `n = 1` case).
 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d, 12) + n * MS_PER_DAY);
  const year = String(shifted.getUTCFullYear()).padStart(4, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Return the weekday of `date` ('YYYY-MM-DD') as 0..6 (Sunday = 0), matching
 * `Date.prototype.getUTCDay`.
 *
 * DST-safe: the date is materialised at 12:00 UTC and read via `getUTCDay`, so
 * the result is offset-independent and never shifts across a transition edge.
 */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/**
 * Compute the next due date for a repeatable series from `anchor`
 * ('YYYY-MM-DD'), or `null` when the schedule has ended (the computed date is
 * strictly after `pattern.end_date`).
 *
 * Rules:
 * - **daily:** `addDays(anchor, max(1, interval ?? 1))`.
 * - **weekly + non-empty `days_of_week`:** scan `addDays(anchor, k)` for
 *   `k = 1..7` and return the first candidate whose weekday is in
 *   `days_of_week`. Out-of-range weekday numbers simply never match; if nothing
 *   matches within 7 days (only possible when the array has no valid 0..6
 *   entry) the interval rule below applies as a fall-through.
 * - **weekly + empty/unset `days_of_week`:** `addDays(anchor, 7 * max(1, interval ?? 1))`.
 *
 * `end_date` guard: when `pattern.end_date` is non-null and the computed date is
 * greater than it (plain 'YYYY-MM-DD' string comparison, which is
 * lexicographically equivalent to date order for zero-padded ISO dates), return
 * `null`; otherwise return the computed date. A null/absent `end_date` never
 * yields `null`.
 */
export function nextDueDate(pattern: RepeatPattern, anchor: string): string | null {
  let next: string;

  if (pattern.frequency === 'weekly' && pattern.days_of_week && pattern.days_of_week.length > 0) {
    const days = pattern.days_of_week;
    let matched: string | null = null;
    for (let k = 1; k <= 7; k += 1) {
      const candidate = addDays(anchor, k);
      if (days.includes(weekdayOf(candidate))) {
        matched = candidate;
        break;
      }
    }
    next = matched ?? addDays(anchor, 7 * Math.max(1, pattern.interval ?? 1));
  } else if (pattern.frequency === 'weekly') {
    next = addDays(anchor, 7 * Math.max(1, pattern.interval ?? 1));
  } else {
    next = addDays(anchor, Math.max(1, pattern.interval ?? 1));
  }

  if (pattern.end_date != null && next > pattern.end_date) {
    return null;
  }
  return next;
}

/**
 * Streak math — pure, deterministic, no I/O.
 *
 * Advances a daily (or per-series) streak given the previously stored state and
 * the user's current Local_Calendar_Date. Dates are 'YYYY-MM-DD' strings and are
 * compared as calendar days. `today` is caller-supplied and already resolved to
 * the user's local zone, so this module stays timezone-agnostic — it only
 * compares day strings and never reads a clock. Consecutive-day detection reuses
 * the DST-safe `nextCalendarDate` helper rather than re-implementing date math.
 */

import { nextCalendarDate } from '../time/userTime';

export interface StreakState {
  current: number;
  longest: number;
  lastCompletedDate: string | null; // 'YYYY-MM-DD'
}

/**
 * Compute the next streak state from `prev` and the user's local `today`.
 *
 * Rules (calendar-day comparisons on 'YYYY-MM-DD' strings):
 * - No prior state (prev == null, or prev.lastCompletedDate == null) → start a
 *   fresh streak: { current: 1, longest: 1, lastCompletedDate: today }.
 * - Same day (prev.lastCompletedDate === today) → idempotent no-op: prev is
 *   returned unchanged (already counted today).
 * - Yesterday (prev.lastCompletedDate is exactly the day before today) →
 *   current + 1, longest = max(longest, current), lastCompletedDate = today.
 * - Otherwise — a gap of more than one day, or a past/backwards date —
 *   the streak resets: current = 1, longest = max(longest, 1),
 *   lastCompletedDate = today.
 */
export function advanceStreak(prev: StreakState | null, today: string): StreakState {
  if (prev == null || prev.lastCompletedDate == null) {
    return { current: 1, longest: 1, lastCompletedDate: today };
  }

  // Idempotent same-day completion — nothing changes.
  if (prev.lastCompletedDate === today) {
    return prev;
  }

  // DST-safe "is prev exactly the day before today?" check.
  if (nextCalendarDate(prev.lastCompletedDate) === today) {
    const current = prev.current + 1;
    return {
      current,
      longest: Math.max(prev.longest, current),
      lastCompletedDate: today,
    };
  }

  // Gap (>1 day) or a backwards/past date → reset the current run.
  return {
    current: 1,
    longest: Math.max(prev.longest, 1),
    lastCompletedDate: today,
  };
}

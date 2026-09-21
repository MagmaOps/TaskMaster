import fc from 'fast-check';
import { nextDueDate, addDays, weekdayOf } from './recurrence';
import type { RepeatPattern } from '../../types/task';

/**
 * Pure property tests for the recurrence scheduling core (no DB, no clock).
 *
 * Covers design.md "Correctness Properties":
 *   - Property 1 (Daily advancement)
 *   - Property 2 (Weekly lands on a scheduled weekday, strictly ahead & earliest)
 *   - Property 3 (Weekly interval fallback)
 *   - Property 4 (End-date boundary)
 *
 * The module's own `addDays` / `weekdayOf` are pure, deterministic and already
 * trusted, so they double as the oracle for advancement/weekday arithmetic —
 * the properties assert that `nextDueDate` composes them correctly per rule.
 *
 * Each property test runs a minimum of 100 iterations.
 */

/** Zero-pad a positive integer to a fixed width. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * A valid 'YYYY-MM-DD' anchor. Days are constrained to 1..28 so the value is
 * always a real calendar date regardless of month length — the recurrence math
 * is calendar-day arithmetic and does not care about month boundaries beyond
 * validity.
 */
const arbAnchor: fc.Arbitrary<string> = fc
  .record({
    y: fc.integer({ min: 2000, max: 2100 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`);

// Interval range spans <1 values (negative and zero) so the `max(1, ...)` clamp
// is exercised alongside normal positive intervals.
const arbInterval = fc.integer({ min: -3, max: 10 });

// A non-empty, duplicate-free set of valid weekday numbers (0..6).
const arbDaysOfWeek = fc.uniqueArray(fc.integer({ min: 0, max: 6 }), {
  minLength: 1,
  maxLength: 7,
});

// A far-future end_date that can never trip the guard for the ranges above.
const FAR_FUTURE = '9999-12-31';

describe('nextDueDate — Property 1 (Daily advancement)', () => {
  // Feature: task-recurrence, Property 1: For any anchor date and daily pattern
  // with interval k, nextDueDate returns the anchor advanced by exactly
  // max(1, k) calendar days (when unconstrained by end_date).
  // Validates: Requirements 3.1, 3.4
  it('daily result === addDays(anchor, max(1, interval)) (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(arbAnchor, arbInterval, (anchor, interval) => {
        const pattern: RepeatPattern = { frequency: 'daily', interval };
        const result = nextDueDate(pattern, anchor);
        expect(result).toBe(addDays(anchor, Math.max(1, interval)));
      }),
      { numRuns: 100 },
    );
  });
});

describe('nextDueDate — Property 2 (Weekly lands on a scheduled weekday, strictly ahead & earliest)', () => {
  // Feature: task-recurrence, Property 2: For any anchor date and weekly pattern
  // with a non-empty days_of_week, nextDueDate returns a date that is strictly
  // after the anchor, whose weekday is in days_of_week, and which is the earliest
  // such date (no earlier scheduled weekday exists between the anchor exclusive
  // and the result inclusive).
  // Validates: Requirements 4.1, 4.3, 4.4
  it('weekly result is scheduled, strictly ahead, and earliest (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(arbAnchor, arbDaysOfWeek, (anchor, days) => {
        const pattern: RepeatPattern = { frequency: 'weekly', days_of_week: days };
        const result = nextDueDate(pattern, anchor);

        // A non-empty valid days_of_week always matches within 7 days, and there
        // is no end_date, so the result is never null.
        expect(result).not.toBeNull();
        const r = result as string;

        // Strictly after the anchor (lexicographic compare is date order for
        // zero-padded ISO dates).
        expect(r > anchor).toBe(true);

        // The result's weekday is one of the scheduled days.
        expect(days).toContain(weekdayOf(r));

        // Earliest: every intermediate day strictly between the anchor and the
        // result is NOT a scheduled weekday, and the result lands within 7 days.
        for (let k = 1; k <= 7; k += 1) {
          const candidate = addDays(anchor, k);
          if (candidate < r) {
            expect(days).not.toContain(weekdayOf(candidate));
          } else {
            // The first candidate that is >= r must be r itself (earliest match).
            expect(candidate).toBe(r);
            break;
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('nextDueDate — Property 3 (Weekly interval fallback)', () => {
  // Feature: task-recurrence, Property 3: For any anchor date and weekly pattern
  // with empty/unset days_of_week and interval k, nextDueDate returns the anchor
  // advanced by exactly 7 * max(1, k) calendar days (when unconstrained by
  // end_date).
  // Validates: Requirements 4.2
  it('weekly with empty days_of_week === addDays(anchor, 7 * max(1, interval)) (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(arbAnchor, arbInterval, (anchor, interval) => {
        const pattern: RepeatPattern = { frequency: 'weekly', interval, days_of_week: [] };
        const result = nextDueDate(pattern, anchor);
        expect(result).toBe(addDays(anchor, 7 * Math.max(1, interval)));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: task-recurrence, Property 3: For any anchor date and weekly pattern
  // with empty/unset days_of_week and interval k, nextDueDate returns the anchor
  // advanced by exactly 7 * max(1, k) calendar days (when unconstrained by
  // end_date).
  // Validates: Requirements 4.2
  it('weekly with unset days_of_week === addDays(anchor, 7 * max(1, interval)) (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(arbAnchor, arbInterval, (anchor, interval) => {
        // days_of_week entirely omitted (undefined) exercises the same fallback.
        const pattern: RepeatPattern = { frequency: 'weekly', interval };
        const result = nextDueDate(pattern, anchor);
        expect(result).toBe(addDays(anchor, 7 * Math.max(1, interval)));
      }),
      { numRuns: 100 },
    );
  });
});

describe('nextDueDate — Property 4 (End-date boundary)', () => {
  // Feature: task-recurrence, Property 4: For any pattern and anchor, if end_date
  // is non-null then nextDueDate returns null exactly when the otherwise-computed
  // next date is strictly greater than end_date ('YYYY-MM-DD' compare), and
  // returns that date otherwise; a null end_date never yields null.
  // Validates: Requirements 5.1, 5.2, 5.3, 5.4
  it('null iff computed next > end_date; null end_date never yields null (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(
        arbAnchor,
        arbInterval,
        arbDaysOfWeek,
        // A base pattern shape: daily, weekly-with-days, or weekly-fallback.
        fc.constantFrom('daily', 'weekly-days', 'weekly-fallback'),
        // Straddle the boundary: end_date = next + delta for delta in [-2..2] so
        // both the null and non-null outcomes are exercised.
        fc.integer({ min: -2, max: 2 }),
        (anchor, interval, days, shape, delta) => {
          // Build the base (unguarded) pattern for this shape.
          let base: RepeatPattern;
          if (shape === 'daily') {
            base = { frequency: 'daily', interval };
          } else if (shape === 'weekly-days') {
            base = { frequency: 'weekly', days_of_week: days };
          } else {
            base = { frequency: 'weekly', interval, days_of_week: [] };
          }

          // The unguarded next date: computed with a far-future end_date so the
          // guard can never trip. This is the oracle for the boundary check.
          const unguarded = nextDueDate({ ...base, end_date: FAR_FUTURE }, anchor);
          // A valid pattern always yields a concrete date here.
          expect(unguarded).not.toBeNull();
          const next = unguarded as string;

          // A null end_date never yields null — it must equal the unguarded date.
          expect(nextDueDate({ ...base, end_date: null }, anchor)).toBe(next);

          // Now place end_date around the computed next date.
          const endDate = addDays(next, delta);
          const guarded = nextDueDate({ ...base, end_date: endDate }, anchor);

          if (next > endDate) {
            expect(guarded).toBeNull();
          } else {
            expect(guarded).toBe(next);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

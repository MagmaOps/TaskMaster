import fc from 'fast-check';
import { candidateUnlocks, type Candidate } from './achievementsService';
import type { CompletionEvent, UnlockedAchievement } from '../completion/completionEvents';
import type { TaskWithMeta } from '../../types/task';

/**
 * Pure property tests for the achievements decision logic (no DB, no clock).
 *
 * Covers design.md "Correctness Properties":
 *   - Property 4 (Threshold candidate correctness & monotonicity)
 *   - Property 5 (Per-slot payload correctness)
 *   - Property 2 (Append iff newly created) — driven with a stubbed `unlock`.
 *
 * All property tests run a minimum of 100 iterations.
 */

// The exact thresholds the pure decision function keys on (mirrors design.md).
const DAILY_STREAK_THRESHOLDS = [7, 14, 30, 90] as const;
const SERIES_STREAK_THRESHOLDS = [7, 30, 100] as const;
const ACCOUNTABLE_DEFERRAL_MIN = 3;

/**
 * Build a minimal-but-valid TaskWithMeta from generated slot values. Only the
 * fields `candidateUnlocks` reads (`id`, `repeat_series_id`, `deferral_count`)
 * carry meaning; the rest are structurally valid placeholders.
 */
function makeTask(params: {
  id: string;
  repeatSeriesId: string | null;
  deferralCount: number;
}): TaskWithMeta {
  return {
    id: params.id,
    user_id: 'user-00000000-0000-0000-0000-000000000000',
    subject: 'x',
    priority: 'medium',
    due_date: null,
    due_time: null,
    is_repeatable: params.repeatSeriesId !== null,
    repeat_pattern: null,
    repeat_series_id: params.repeatSeriesId,
    created_at: new Date(0),
    completed_at: new Date(0),
    archived_at: null,
    updated_at: new Date(0),
    weight_at_completion: null,
    deferral_count: params.deferralCount,
    projects: [],
  };
}

/** Build a CompletionEvent from generated inputs. */
function makeEvent(params: {
  taskId: string;
  repeatSeriesId: string | null;
  deferralCount: number;
  weightAtCompletion: number;
  streaks?: { daily: number; series?: number };
}): CompletionEvent {
  return {
    userId: 'user-00000000-0000-0000-0000-000000000000',
    task: makeTask({
      id: params.taskId,
      repeatSeriesId: params.repeatSeriesId,
      deferralCount: params.deferralCount,
    }),
    weightAtCompletion: params.weightAtCompletion,
    unlocked: [],
    streaks: params.streaks,
  };
}

// Non-negative integer arbitrary that comfortably straddles every threshold
// boundary (7, 14, 30, 90, 100) so both sides of each `>= N` are exercised.
const arbCount = fc.integer({ min: 0, max: 200 });
const arbWeight = fc.integer({ min: 0, max: 500 });
const arbThreshold = fc.integer({ min: 1, max: 500 });
// A streaks object with daily always present and series optionally present, or
// streaks entirely undefined — matching the runtime channel shape.
const arbStreaks = fc.option(
  fc.record(
    { daily: arbCount, series: fc.option(arbCount, { nil: undefined }) },
    { requiredKeys: ['daily'] },
  ),
  { nil: undefined },
);
const arbSeriesId = fc.option(fc.uuid(), { nil: null });

function typesOf(candidates: Candidate[]): Set<string> {
  return new Set(candidates.map((c) => c.type));
}

describe('candidateUnlocks — Property 4 (threshold correctness & monotonicity)', () => {
  // Feature: achievements, Property 4: For any completion event and configured
  // threshold, candidateUnlocks yields a numeric-threshold milestone candidate
  // (daily_streak_N from event.streaks.daily; repeatable_streak_N from
  // event.streaks.series when repeat_series_id is non-null; accountable_procrastination
  // from deferral_count >= 3; high_weight_completed from weightAtCompletion >= threshold)
  // if and only if the corresponding value is greater than or equal to that
  // milestone's threshold; and increasing any such value never removes a candidate
  // that already qualified (monotonicity). When event.streaks or the relevant field
  // is undefined, or repeat_series_id is null, no candidate for the corresponding
  // streak family is produced.
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.5, 5.1, 6.2, 10.4
  it('produces exactly the candidates whose value >= threshold (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbSeriesId,
        arbCount,
        arbWeight,
        arbThreshold,
        arbStreaks,
        (taskId, repeatSeriesId, deferralCount, weightAtCompletion, threshold, streaks) => {
          const event = makeEvent({
            taskId,
            repeatSeriesId,
            deferralCount,
            weightAtCompletion,
            streaks,
          });
          const types = typesOf(candidateUnlocks(event, threshold));

          const daily = streaks?.daily;
          for (const n of DAILY_STREAK_THRESHOLDS) {
            const expected = typeof daily === 'number' && daily >= n;
            expect(types.has(`daily_streak_${n}`)).toBe(expected);
          }

          const series = streaks?.series;
          const seriesQualifies = repeatSeriesId !== null && typeof series === 'number';
          for (const n of SERIES_STREAK_THRESHOLDS) {
            const expected = seriesQualifies && (series as number) >= n;
            expect(types.has(`repeatable_streak_${n}`)).toBe(expected);
          }

          expect(types.has('accountable_procrastination')).toBe(
            deferralCount >= ACCOUNTABLE_DEFERRAL_MIN,
          );
          expect(types.has('high_weight_completed')).toBe(weightAtCompletion >= threshold);

          // DB-dependent milestones must NEVER appear in the pure candidate set.
          expect(types.has('first_task_completed')).toBe(false);
          expect(types.has('productivity_burst_10')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: achievements, Property 4: ...increasing any such value never removes
  // a candidate that already qualified (monotonicity).
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.5, 5.1, 6.2, 10.4
  it('monotonicity: raising any value keeps the candidate set a superset (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.record({
          daily: arbCount,
          series: arbCount,
          deferralCount: arbCount,
          weightAtCompletion: arbWeight,
        }),
        fc.record({
          daily: fc.nat(50),
          series: fc.nat(50),
          deferralCount: fc.nat(50),
          weightAtCompletion: fc.nat(200),
        }),
        arbThreshold,
        (taskId, seriesId, base, bump, threshold) => {
          // Same task id + non-null series id across both events so slot-based
          // families are comparable; only the numeric values are raised.
          const lo = makeEvent({
            taskId,
            repeatSeriesId: seriesId,
            deferralCount: base.deferralCount,
            weightAtCompletion: base.weightAtCompletion,
            streaks: { daily: base.daily, series: base.series },
          });
          const hi = makeEvent({
            taskId,
            repeatSeriesId: seriesId,
            deferralCount: base.deferralCount + bump.deferralCount,
            weightAtCompletion: base.weightAtCompletion + bump.weightAtCompletion,
            streaks: {
              daily: base.daily + bump.daily,
              series: base.series + bump.series,
            },
          });

          const loTypes = typesOf(candidateUnlocks(lo, threshold));
          const hiTypes = typesOf(candidateUnlocks(hi, threshold));

          // Every candidate that qualified at the lower values still qualifies
          // at the raised values.
          for (const t of loTypes) {
            expect(hiTypes.has(t)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: achievements, Property 4: ...When event.streaks or the relevant field
  // is undefined, or repeat_series_id is null, no candidate for the corresponding
  // streak family is produced.
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.5, 5.1, 6.2, 10.4
  it('no streak candidates when streaks/field undefined or series id null (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbSeriesId,
        arbCount,
        arbWeight,
        arbThreshold,
        arbStreaks,
        (taskId, repeatSeriesId, deferralCount, weightAtCompletion, threshold, streaks) => {
          const event = makeEvent({
            taskId,
            repeatSeriesId,
            deferralCount,
            weightAtCompletion,
            streaks,
          });
          const types = typesOf(candidateUnlocks(event, threshold));

          // Daily family only when streaks.daily is a number.
          if (typeof streaks?.daily !== 'number') {
            for (const n of DAILY_STREAK_THRESHOLDS) {
              expect(types.has(`daily_streak_${n}`)).toBe(false);
            }
          }
          // Series family only when repeat_series_id is non-null AND series is a number.
          if (repeatSeriesId === null || typeof streaks?.series !== 'number') {
            for (const n of SERIES_STREAK_THRESHOLDS) {
              expect(types.has(`repeatable_streak_${n}`)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('candidateUnlocks — Property 5 (per-slot payload correctness)', () => {
  // Feature: achievements, Property 5: For any per-slot candidate produced by
  // candidateUnlocks (repeatable-series, accountable-procrastination, high-weight
  // — and, at the service layer, productivity-burst), the constructed data payload
  // stores the candidate's slot value under data.task_id (the key
  // idx_achievements_unique reads), so the appended Unlocked_Achievement carries
  // the slot value.
  // Validates: Requirements 3.1, 3.2, 3.3, 5.1, 6.2, 8.3
  it('per-slot candidates carry their slot under data.task_id (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        // Values chosen to force at least some per-slot candidates to appear:
        // deferral_count >= 3 and weight >= threshold, plus a qualifying series.
        fc.integer({ min: ACCOUNTABLE_DEFERRAL_MIN, max: 200 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: SERIES_STREAK_THRESHOLDS[0], max: 200 }),
        (taskId, seriesId, deferralCount, weight, threshold, series) => {
          const event = makeEvent({
            taskId,
            repeatSeriesId: seriesId,
            deferralCount,
            weightAtCompletion: Math.max(weight, threshold), // ensure high-weight qualifies
            streaks: { daily: 0, series },
          });
          const candidates = candidateUnlocks(event, threshold);

          for (const c of candidates) {
            // Build the data payload exactly as the service does when appending.
            const data: Record<string, unknown> = {
              ...(c.slot != null ? { task_id: c.slot } : {}),
              ...c.dataExtra,
            };

            if (c.type.startsWith('repeatable_streak_')) {
              expect(c.slot).toBe(seriesId);
              expect(data.task_id).toBe(seriesId);
              expect(data.series_id).toBe(seriesId);
            } else if (
              c.type === 'accountable_procrastination' ||
              c.type === 'high_weight_completed'
            ) {
              expect(c.slot).toBe(taskId);
              expect(data.task_id).toBe(taskId);
            } else {
              // daily_streak_* are global — no slot.
              expect(c.slot).toBeNull();
              expect('task_id' in data).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Import the service and its dependencies to drive Property 2 with a stubbed
// repository. jest.mock hoists these above the imports at runtime.
jest.mock('../../repositories/achievementsRepository');
jest.mock('../../repositories/userRepository');

import * as achievementsRepo from '../../repositories/achievementsRepository';
import * as userRepo from '../../repositories/userRepository';
import { onTaskCompleted } from './achievementsService';

describe('onTaskCompleted — Property 2 (append iff newly created)', () => {
  // Feature: achievements, Property 2: For any completion event, the achievements
  // listener appends an Unlocked_Achievement to event.unlocked for a given
  // (type, slot) exactly when the corresponding unlock created a new row (returned
  // true), and never appends when unlock reported a conflict — so re-evaluating the
  // same completion adds each achievement to event.unlocked at most once per
  // newly-created row.
  // Validates: Requirements 1.3, 2.6, 3.6, 4.5, 5.3, 6.4, 7.2, 7.3, 8.1, 8.2
  it('appends exactly one entry per unlock() that returned true (fast-check, >= 100 runs)', async () => {
    const unlockMock = achievementsRepo.unlock as jest.MockedFunction<
      typeof achievementsRepo.unlock
    >;
    const countMock = achievementsRepo.countCompletionsOnLocalDay as jest.MockedFunction<
      typeof achievementsRepo.countCompletionsOnLocalDay
    >;
    const findByIdMock = userRepo.findById as jest.MockedFunction<typeof userRepo.findById>;

    await fc.assert(
      fc.asyncProperty(
        // A generated boolean sequence long enough to cover every unlock() call
        // the service can make in one completion (first + up to 4 daily + up to 3
        // series + accountable + high-weight + burst = well under 32).
        fc.array(fc.boolean(), { minLength: 32, maxLength: 32 }),
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        async (bools, taskId, seriesId, deferralCount, weight, daily, series) => {
          // Each unlock() call consumes the next boolean from the sequence, so we
          // control precisely how many "newly created" results occur — regardless
          // of which milestones the event happens to qualify for.
          let i = 0;
          unlockMock.mockReset();
          unlockMock.mockImplementation(async () => bools[i++ % bools.length]);
          countMock.mockReset();
          // Sometimes qualify the burst milestone, sometimes not.
          countMock.mockResolvedValue(daily % 2 === 0 ? 10 : 0);
          findByIdMock.mockReset();
          findByIdMock.mockResolvedValue({
            id: taskId,
            settings: { timezone: 'UTC' },
          } as unknown as Awaited<ReturnType<typeof userRepo.findById>>);

          const event = makeEvent({
            taskId,
            repeatSeriesId: seriesId,
            deferralCount,
            weightAtCompletion: weight,
            streaks: { daily, series },
          });

          await onTaskCompleted(event);

          // The invariant: the number of appended entries equals the number of
          // unlock() calls that returned true. `i` is the total number of
          // unlock() calls made; count how many of those returned true.
          const trueCount = bools.slice(0, i).filter(Boolean).length;
          expect(event.unlocked.length).toBe(trueCount);

          // And nothing was appended for a false result: total calls minus
          // appended equals the number of false results consumed.
          const falseConsumed = i - trueCount;
          expect(i - event.unlocked.length).toBe(falseConsumed);

          // Every appended item is a well-formed UnlockedAchievement.
          for (const u of event.unlocked as UnlockedAchievement[]) {
            expect(typeof u.type).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** Achievements service — completion listener + read model. */

import { config } from '../../config';
import * as achievementsRepo from '../../repositories/achievementsRepository';
import * as userRepo from '../../repositories/userRepository';
import { resolveTimezone, localCalendarDate } from '../time/userTime';
import type { CompletionEvent } from '../completion/completionEvents';

/** A single unlocked achievement row as stored in the achievements table. */
export interface AchievementRow {
  id: string;
  type: string;
  unlocked_at: Date;
  data: Record<string, unknown>;
}

/**
 * An event-derivable achievement candidate: the `type`, its idempotency `slot`
 * (written to `data.task_id`; `null` for global-once milestones), and any
 * readable semantic alias stored alongside the slot (`dataExtra`).
 */
export interface Candidate {
  type: string;
  slot: string | null;
  dataExtra?: Record<string, unknown>;
}

/** Daily-streak milestone thresholds, ascending. */
const DAILY_STREAK_THRESHOLDS = [7, 14, 30, 90] as const;
/** Repeatable-series streak milestone thresholds, ascending. */
const SERIES_STREAK_THRESHOLDS = [7, 30, 100] as const;
/** Deferral count that qualifies for the accountable-procrastination milestone. */
const ACCOUNTABLE_DEFERRAL_MIN = 3;

/**
 * Pure decision helper: the achievement candidates whose *condition* is fully
 * decidable from the completion event alone — no database, no clock, no I/O.
 *
 * Covers the four event-derivable milestone families, evaluated in this order
 * (order is deterministic but not semantically significant):
 *   1. daily-streak      — from `event.streaks.daily`
 *   2. repeatable-series — from `event.streaks.series` + `event.task.repeat_series_id`
 *   3. accountable-procrastination — from `event.task.deferral_count`
 *   4. high-weight       — from `event.weightAtCompletion` vs `threshold`
 *
 * It deliberately EXCLUDES the two DB-dependent milestones, which cannot be
 * decided from the event alone and are handled at the service layer (Task 5):
 *   - `first_task_completed`  — "no prior first" is a DB fact, resolved by the
 *     idempotent insert result, not the event.
 *   - `productivity_burst_10` — needs the tz-aware day-count DB query.
 *
 * All comparisons use `>= N` (DD-3), so the result is monotonic: raising any
 * qualifying value never removes a candidate that already qualified.
 *
 * Guard rules (Property 4): when `event.streaks` or `streaks.daily` is
 * undefined no daily candidates are produced; when `repeat_series_id` is null
 * or `streaks.series` is undefined no series candidates are produced.
 */
export function candidateUnlocks(event: CompletionEvent, threshold: number): Candidate[] {
  const candidates: Candidate[] = [];
  const { task, streaks, weightAtCompletion } = event;

  // 1. Daily-streak (global — no slot, no dataExtra).
  const daily = streaks?.daily;
  if (typeof daily === 'number') {
    for (const n of DAILY_STREAK_THRESHOLDS) {
      if (daily >= n) {
        candidates.push({ type: `daily_streak_${n}`, slot: null });
      }
    }
  }

  // 2. Repeatable-series (slot = series id; alias under dataExtra.series_id).
  const seriesId = task.repeat_series_id;
  const series = streaks?.series;
  if (seriesId !== null && typeof series === 'number') {
    for (const n of SERIES_STREAK_THRESHOLDS) {
      if (series >= n) {
        candidates.push({
          type: `repeatable_streak_${n}`,
          slot: seriesId,
          dataExtra: { series_id: seriesId },
        });
      }
    }
  }

  // 3. Accountable procrastination (slot = task id).
  if (task.deferral_count >= ACCOUNTABLE_DEFERRAL_MIN) {
    candidates.push({ type: 'accountable_procrastination', slot: task.id });
  }

  // 4. High weight (slot = task id) — uses the already-computed completion
  // weight verbatim; never recomputed (DD-2).
  if (weightAtCompletion >= threshold) {
    candidates.push({ type: 'high_weight_completed', slot: task.id });
  }

  return candidates;
}

/** Minimum same-local-day completions that unlock the productivity burst. */
const PRODUCTIVITY_BURST_MIN = 10;

/**
 * Completion listener — MUST be registered AFTER the streak listener, which
 * populates `event.streaks` that the pure `candidateUnlocks` reads (see
 * `registerAllListeners`). Orchestrates every milestone check for one
 * completion and appends each newly-created unlock to `event.unlocked`.
 *
 * Two milestones are DB-dependent and handled outside `candidateUnlocks`:
 *   - `first_task_completed` — "no prior first" is decided by the idempotent
 *     insert result, not the event.
 *   - `productivity_burst_10` — needs the tz-aware same-day completion count.
 *
 * Non-throwing in normal operation (Req 10.3): a missing user resolves to UTC,
 * absent `event.streaks` yields no streak candidates, and conflicting inserts
 * simply return false. No try/catch swallows unexpected errors — the completion
 * dispatcher already isolates listener throws (Req 10.2).
 */
export async function onTaskCompleted(event: CompletionEvent): Promise<void> {
  /**
   * Attempt one idempotent unlock and append `{ type, data }` to
   * `event.unlocked` ONLY when a new row was created. The appended `data`
   * mirrors what the repository persists: the slot under `data.task_id` plus
   * any alias, so the client sees the slot value (Req 8.3). With no slot and no
   * alias the payload is `{}`.
   */
  async function tryUnlock(
    type: string,
    slot: string | null,
    dataExtra?: Record<string, unknown>,
  ): Promise<void> {
    const created = await achievementsRepo.unlock(event.userId, type, slot, dataExtra);
    if (created) {
      const data: Record<string, unknown> = {
        ...(slot != null ? { task_id: slot } : {}),
        ...dataExtra,
      };
      event.unlocked.push({ type, data });
    }
  }

  // a. first_task_completed (DB-dependent, Req 1): the idempotent insert IS the
  // "no prior first" check — a conflict means the user already has one.
  await tryUnlock('first_task_completed', null);

  // b. Pure event-derivable candidates (Req 2, 3, 5, 6).
  for (const c of candidateUnlocks(event, config.achievements.highWeightThreshold)) {
    await tryUnlock(c.type, c.slot, c.dataExtra);
  }

  // c. productivity_burst_10 (DB-dependent, Req 4): count the user's completions
  // on their local day (UTC fallback when the user/timezone is missing).
  const user = await userRepo.findById(event.userId);
  const tz = resolveTimezone(user?.settings.timezone);
  const localDay = localCalendarDate(tz);
  const count = await achievementsRepo.countCompletionsOnLocalDay(event.userId, tz, localDay);
  if (count >= PRODUCTIVITY_BURST_MIN) {
    // Slot = localDay (stored under data.task_id) with a readable local_date alias.
    await tryUnlock('productivity_burst_10', localDay, { local_date: localDay });
  }
}

/** Read model for GET /api/achievements — all unlocks for the user, newest first. */
export async function getAchievements(userId: string): Promise<AchievementRow[]> {
  return achievementsRepo.listForUser(userId);
}

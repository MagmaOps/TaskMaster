import { advanceStreak, type StreakState } from './streakMath';
import * as streakRepo from '../../repositories/streakRepository';
import type { UserStreaks } from '../../repositories/streakRepository';
import * as userRepo from '../../repositories/userRepository';
import { resolveTimezone, localCalendarDate } from '../time/userTime';
import type { CompletionEvent } from '../completion/completionEvents';

/**
 * Streak service — the completion-listener side of streaks.
 *
 * Owns the timezone boundary: it resolves the user's Local_Calendar_Date once
 * per completion and feeds that single `today` into the pure `advanceStreak`
 * math (which stays timezone-agnostic). Models the economy listener pattern:
 * `onTaskCompleted(event)` is registered on the completion dispatcher.
 */

/**
 * Advance one streak key (daily when `seriesId` is null, otherwise per-series)
 * to `today` and persist it. Loads the prior state, applies the pure
 * `advanceStreak` rules, upserts the result, and returns the resulting
 * `current` run length so the caller can publish it for later listeners.
 *
 * `today` MUST be the user's Local_Calendar_Date ('YYYY-MM-DD'), never a
 * server-local date — see `onTaskCompleted`.
 */
export async function applyForCompletion(
  userId: string,
  seriesId: string | null,
  today: string,
): Promise<number> {
  const prev = await streakRepo.getByKey(userId, seriesId);
  const next: StreakState = advanceStreak(prev, today);
  await streakRepo.upsert(userId, seriesId, next);
  return next.current;
}

/**
 * Completion listener: advance the daily streak and, for a repeatable task, the
 * per-series streak for the same completion.
 *
 * The user's Local_Calendar_Date is resolved once (from their stored timezone,
 * falling back to UTC when unset/invalid) and reused for every
 * `applyForCompletion` call, so "consecutive days" is measured in the user's
 * zone rather than the server's. A non-repeatable task (no `repeat_series_id`)
 * never creates or updates a per-series streak (Req 2.2). The computed values
 * are stashed on `event.streaks` for later listeners (e.g. achievements) to
 * read without re-querying.
 */
export async function onTaskCompleted(event: CompletionEvent): Promise<void> {
  // Resolve the user's local "today" once; UTC when unset/invalid or user missing.
  const user = await userRepo.findById(event.userId);
  const today = localCalendarDate(resolveTimezone(user?.settings.timezone));

  const daily = await applyForCompletion(event.userId, null, today);

  let series: number | undefined;
  const seriesId = event.task.repeat_series_id;
  if (event.task.is_repeatable && seriesId) {
    series = await applyForCompletion(event.userId, seriesId, today);
  }

  // Publish for later listeners (achievements) — omit `series` when absent.
  event.streaks = { daily, ...(series !== undefined ? { series } : {}) };
}

/**
 * Read a user's streaks for the API/controller: the daily streak plus every
 * per-series streak (with representative subject labels), in the
 * `{ daily, series }` shape produced by the repository.
 */
export async function getStreaks(userId: string): Promise<UserStreaks> {
  return await streakRepo.listForUser(userId);
}
